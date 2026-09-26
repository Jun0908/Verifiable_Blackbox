# Home／Hotspotの切替とUSB復旧

`secrets.h` にHomeとHotspotを設定し、Rover・カメラへそれぞれ書き込んでから使用します。
この提出版はダミー設定でのビルドだけを確認しています。

Windowsでは両SSIDへ一度ずつ手動接続して、Wi-Fi profileを保存してください。
`start_rover_home.cmd` / `start_rover_hotspot.cmd` から明示選択します。
現在のネットワークで見つかったRoverを停止・確認してから機器へ切替を要求し、PCを選択先へ移動します。
選択先でRoverとカメラ両方のprofile・接続を確認するまで操作画面を起動しません。
カメラを省く場合だけ `hotspot_launcher.py --profile home --rover-only --web` を使います。

停止確認失敗ならPCのネットワークを変更しません。機器が見つからなくても別SSIDへ自動移動しません。
PC・機器が別々のLANに残った場合、機器をUSBで復旧してから再実行します。
Windowsのネットワーク表示名はSSIDと異なる場合があるため、実SSIDとIPv4取得を確認します。

## USB復旧

RoverとカメラのUSBを識別し、対象だけのシリアルモニタを115200 baudで開きます。
次のどちらかを改行付きで送信します。通常版Roverでも使用できます。

```text
network home
network hotspot
```

Roverは停止・DISARM後に切り替えます。未設定profileは拒否します。
Wi-Fi設定と署名鍵は別のNVS領域なので、復旧のためにFlashを消去しないでください。
設定先が不在なら同じprofileを再試行し、別profileへfallbackしません。

macOS/LinuxではPCのWi-Fiを手動で選択し、必要なら上記USBコマンドで機器も揃えます。
Windows専用launcherは使用せず、`.env` に同じLAN上のRover URLを設定して
`python web_bridge_server.py --web` を起動します。
