#include "device_signature.h"

#if DEVICE_SIGNATURE_ENABLED
#include <Preferences.h>
#include "signature_message.h"
#include <esp_system.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/platform_util.h>
#include <mbedtls/sha256.h>

namespace DeviceSignature {
namespace {

portMUX_TYPE stateLock = portMUX_INITIALIZER_UNLOCKED;
struct Result {
  uint8_t state = 0;  // idle, busy, ready, error
  bool hasSignature = false;
  uint8_t message[128] = {};
  uint8_t publicKey[64] = {};
  uint8_t digest[32] = {};
  uint8_t signature[64] = {};
};
Result result;
uint8_t requestedMessage[128];
bool requestedKeyOnly = false;

int randomBytes(void*, unsigned char* out, size_t length) {
  esp_fill_random(out, length);
  return 0;
}

String hex(const uint8_t* bytes, size_t length) {
  static const char digits[] = "0123456789abcdef";
  String text("0x");
  text.reserve(length * 2 + 2);
  for (size_t i = 0; i < length; ++i) {
    text += digits[bytes[i] >> 4];
    text += digits[bytes[i] & 15];
  }
  return text;
}

bool loadKey(mbedtls_ecp_keypair& key) {
  if (mbedtls_ecp_group_load(&key.grp, MBEDTLS_ECP_DP_SECP256R1) != 0) return false;
  Preferences storage;
  if (!storage.begin("vbb-signature", false)) return false;
  uint8_t secret[32] = {};
  bool ok = false;
  if (storage.isKey("p256-key")) {
    // A damaged key must not silently turn into a new device identity.
    ok = storage.getBytesLength("p256-key") == sizeof(secret) &&
         storage.getBytes("p256-key", secret, sizeof(secret)) == sizeof(secret) &&
         mbedtls_mpi_read_binary(&key.d, secret, sizeof(secret)) == 0 &&
         mbedtls_ecp_check_privkey(&key.grp, &key.d) == 0 &&
         mbedtls_ecp_mul(&key.grp, &key.Q, &key.d, &key.grp.G, randomBytes, nullptr) == 0;
  } else {
    ok = mbedtls_ecp_gen_keypair(&key.grp, &key.d, &key.Q, randomBytes, nullptr) == 0 &&
         mbedtls_mpi_write_binary(&key.d, secret, sizeof(secret)) == 0 &&
         storage.putBytes("p256-key", secret, sizeof(secret)) == sizeof(secret);
  }
  mbedtls_platform_zeroize(secret, sizeof(secret));
  storage.end();
  return ok;
}

void worker(void*) {
  Result next;
  memcpy(next.message, requestedMessage, sizeof(next.message));
  mbedtls_ecp_keypair key;
  mbedtls_ecp_keypair_init(&key);
  mbedtls_mpi r, s, half;
  mbedtls_mpi_init(&r);
  mbedtls_mpi_init(&s);
  mbedtls_mpi_init(&half);
  bool ok = loadKey(key) &&
            mbedtls_mpi_write_binary(&key.Q.X, next.publicKey, 32) == 0 &&
            mbedtls_mpi_write_binary(&key.Q.Y, next.publicKey + 32, 32) == 0;
  if (ok && !requestedKeyOnly) {
    ok = mbedtls_sha256_ret(next.message, sizeof(next.message), next.digest, 0) == 0 &&
         mbedtls_ecdsa_sign(&key.grp, &r, &s, &key.d, next.digest, 32, randomBytes, nullptr) == 0 &&
         mbedtls_mpi_copy(&half, &key.grp.N) == 0 &&
         mbedtls_mpi_shift_r(&half, 1) == 0;
    if (ok && mbedtls_mpi_cmp_mpi(&s, &half) > 0) {
      ok = mbedtls_mpi_sub_mpi(&s, &key.grp.N, &s) == 0;
    }
    ok = ok && mbedtls_mpi_write_binary(&r, next.signature, 32) == 0 &&
         mbedtls_mpi_write_binary(&s, next.signature + 32, 32) == 0;
    next.hasSignature = ok;
  }
  mbedtls_mpi_free(&r);
  mbedtls_mpi_free(&s);
  mbedtls_mpi_free(&half);
  mbedtls_ecp_keypair_free(&key);
  next.state = ok ? 2 : 3;
  portENTER_CRITICAL(&stateLock);
  result = next;
  portEXIT_CRITICAL(&stateLock);
  vTaskDelete(nullptr);
}
}  // namespace

bool busy() {
  portENTER_CRITICAL(&stateLock);
  bool value = result.state == 1;
  portEXIT_CRITICAL(&stateLock);
  return value;
}

void status(WebServer& server) {
  Result snapshot;
  portENTER_CRITICAL(&stateLock);
  snapshot = result;
  portEXIT_CRITICAL(&stateLock);
  const char* states[] = {"idle", "busy", "ready", "error"};
  String body = String("{\"version\":1,\"state\":\"") + states[snapshot.state] + "\"";
  if (snapshot.state == 3) body += ",\"error\":\"KEY_OR_SIGNATURE_FAILED\"";
  if (snapshot.state == 2) {
    body += ",\"publicKey\":\"" + hex(snapshot.publicKey, 64) + "\"";
    if (snapshot.hasSignature) {
      body += ",\"schema\":\"DeviceJobSignatureV1\",\"chainId\":\"" + hex(snapshot.message + 32, 32) +
              "\",\"core\":\"" + hex(snapshot.message + 76, 20) +
              "\",\"jobId\":\"" + hex(snapshot.message + 96, 32) +
              "\",\"digest\":\"" + hex(snapshot.digest, 32) +
              "\",\"signature\":\"" + hex(snapshot.signature, 64) + "\"";
    }
  }
  server.sendHeader("Cache-Control", "no-store");
  server.send(snapshot.state == 1 ? 202 : snapshot.state == 3 ? 500 : 200,
              "application/json", body + "}");
}

void request(WebServer& server, bool keyOnly) {
  if (busy()) {
    server.send(409, "application/json", "{\"error\":\"SIGNATURE_BUSY\"}");
    return;
  }
  uint8_t message[128] = {};
  uint8_t schemaHash[32];
  if (mbedtls_sha256_ret(reinterpret_cast<const uint8_t*>(DeviceJob::schema), strlen(DeviceJob::schema), schemaHash, 0) != 0) {
    server.send(500, "application/json", "{\"error\":\"HASH_FAILED\"}");
    return;
  }
  memcpy(message, schemaHash, 32);
  if (!keyOnly && !DeviceJob::message(schemaHash, server.arg("chain_id").c_str(), server.arg("core").c_str(), server.arg("job_id").c_str(), message)) {
    server.send(400, "application/json", "{\"error\":\"INVALID_JOB_CONTEXT\"}");
    return;
  }
  portENTER_CRITICAL(&stateLock);
  bool cached = result.state == 2 &&
                (keyOnly || (result.hasSignature && memcmp(result.message, message, 128) == 0));
  portEXIT_CRITICAL(&stateLock);
  if (cached) { status(server); return; }
  memcpy(requestedMessage, message, sizeof(message));
  requestedKeyOnly = keyOnly;
  portENTER_CRITICAL(&stateLock);
  result.state = 1;
  portEXIT_CRITICAL(&stateLock);
  // Low priority; the Arduino loop continues to service stop/watchdog/network.
  if (xTaskCreate(worker, "device-sign", 12288, nullptr, 1, nullptr) != pdPASS) {
    portENTER_CRITICAL(&stateLock);
    result.state = 3;
    portEXIT_CRITICAL(&stateLock);
  }
  status(server);
}
}  // namespace DeviceSignature
#endif
