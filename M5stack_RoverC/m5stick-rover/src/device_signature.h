#pragma once

#ifndef DEVICE_SIGNATURE_ENABLED
#define DEVICE_SIGNATURE_ENABLED 0
#endif

#if DEVICE_SIGNATURE_ENABLED
#include <WebServer.h>

// These handlers never control motors. The caller supplies authentication and
// a stopped/disarmed check before accepting a signing or key request.
namespace DeviceSignature {
bool busy();
void status(WebServer& server);
void request(WebServer& server, bool keyOnly);
}
#endif
