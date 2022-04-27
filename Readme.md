# ubisoft-dmx-decode

## How to capture requests from Ubisoft Connect

### 1. Keydumping Setup

1. Prerequesites:
   - Windows 10 or Windows 11
   - Python 3.9 (I used pyenv)
   - Wireshark
1. If you're on Windows 11: ([source](https://github.com/ngo/win-frida-scripts/issues/2))
   - Search for "Exploit protection" and open
   - Click "Program settings"
   - Click "Add program to customize"
   - Click "Add program by name"
   - Enter `lsass.exe` and continue
   - Scroll to "Hardware-enforced Stack Protection", turn it **Off**, and click Apply
   - Restart your computer
1. Install [frida](https://github.com/frida/frida#1-install-from-prebuilt-binaries) and ensure it works

    ```ps
    > pip install frida-tools
    > frida --version
    15.1.15
    ```

1. Save [`keylog.js`](https://raw.githubusercontent.com/ngo/win-frida-scripts/master/lsasslkeylog-easy/keylog.js) somewhere you'll remember

### 2. Capturing Keys

1. Close Ubisoft Connect
1. Search for "Windows PowerShell", right-click it and **Run as administrator**
1. Start capturing keys with

    ```ps
    frida --no-pause lsass.exe -l \path\to\keylog.js
    ```

   - If frida can't find `lsass.exe`, get its process ID from the Task Manager Details tab, or by running `Get-Process -Name lsass` and use that instead of `lsass.exe` in the `frida` command

1. You should see `C:\keylog.log` beginning to populate. Keep `frida` running until you're done capturing packets

### 3. Capturing Packets

1. Open Wireshark
1. Go to Edit > Preferences > Protocols > TLS > (Pre)-Master-Secret log filename > Browse... > navigate to `C:\keylog.log`, then click OK
1. View > Name Resolution > Check "Resolve Network Addresses"
1. Click your adapter in the "Capture" list to begin capturing (I use "Ethernet")
1. Open Ubisoft Connect and do some things
1. Click the 🟥 button to stop capture
1. In the filter bar, enter `(ip.dst_host == dmx.upc.ubisoft.com) || (ip.src_host == dmx.upc.ubisoft.com)`
1. Press CTRL+R to reload the packets to ensure decryption applies
1. Right click a TLSv1.2 packet > Follow > TLS Stream, a window containing some readable text should appear. This means the decryption is working.

### 4. Decoding the requests

1. Set the filter back to `(ip.dst_host == dmx.upc.ubisoft.com) || (ip.src_host == dmx.upc.ubisoft.com)`
1. File > Export Packet Dissections > As JSON > Save as `dmx-upc.json` with the default settings
1. Clone this project
1. `npm i`
1. Move `dmx-upc.json` to the root of the project
1. `npm start`. The output will be written to `decodes.json`

## How to get the .proto's

Only needed if you need to update the protos

1. [Follow steps 1-3 of this guide](https://github.com/claabs/uplay-install-reverse#protobuf-schema).
1. Copy the `upc_protos` folder here and rename it to `proto`
