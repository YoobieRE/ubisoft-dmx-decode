# Ubisoft gRPC

## Install

After `npm i`, for it to run, you'll need to go to `node_modules/rawproto/package.json` and change `exports` to `"./dist/rawproto.cjs"`.

## How to get the .proto's

Only needed if you need to update the protos

1. [Follow steps 1-3 of this guide](https://github.com/claabs/uplay-install-reverse#protobuf-schema).
1. Copy the `upc_protos` folder here and rename it to `proto`

## How to get the wireshark JSON

1. Setup `lsass` keydumping from [this guide](https://github.com/ngo/win-frida-scripts/tree/master/lsasslkeylog-easy) (special thanks to @Lariaa for helping me find this solution to get around certificate pinning!)
1. In Wireshark, capture packets from a Ubisoft Connect session
1. After capture, CTRL+R to reload the packets so decryption applies
1. Filter packet capture with `(ip.dst == 216.98.50.146) || (ip.src == 216.98.50.146)`
1. File > Export Packet Dissections > As JSON > Save here as `dmx-upc.json`
