/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-promise-executor-return */
import protobuf from 'protobufjs';
import glob from 'glob';
import { readFileSync, outputJSONSync } from 'fs-extra';
import * as rawproto from 'rawproto';
import jsonHandler from './util/json-dupe-parse'; // Handles duplicate JSON keys

const protoFiles = glob.sync('proto/**/*.proto');
console.log(`Loaded ${protoFiles.length} protos`);
const packageDefinition = protobuf.loadSync(protoFiles);
outputJSONSync('definition.json', packageDefinition.toJSON());

interface TLSPayload {
  data: Buffer;
  timestamp: Date;
  src: string;
  dst: string;
}
const jsonBufferReplacer = (_key: string, val: any) => {
  if (val?.type === 'Buffer') {
    return Buffer.from(val).toString('utf-8');
  }
  return val;
};

const getTLSPayload = (wsPacket: any): TLSPayload[] | null => {
  const layers = wsPacket._source?.layers;
  const data: string = layers?.data?.['data.data'];
  if (!data) return null;
  const timestamp = new Date(
    parseFloat(wsPacket._source?.layers?.frame['frame.time_epoch']) * 1000
  );
  const src = wsPacket._source?.layers?.ip['ip.src'];
  const dst = wsPacket._source?.layers?.ip['ip.dst'];

  const dataKeys = Object.keys(layers).filter((key) => key.match(/data\d*/));
  const payloads = dataKeys
    .map((key) => {
      const currentData = layers[key]?.['data.data'];
      if (!currentData) return null;
      return {
        timestamp,
        src,
        dst,
        data: Buffer.from(currentData.replace(/:/g, ''), 'hex'),
      };
    })
    .filter((p): p is TLSPayload => p !== null);
  return payloads;
};

const payloadJoiner = (payloads: TLSPayload[]): TLSPayload[] => {
  const joinedPayloads: TLSPayload[] = [];
  let currentPayload: Buffer | null = null;
  let currentPayloadLength: number | null = null;
  payloads.forEach((payload) => {
    const { data } = payload;
    if (currentPayload === null) {
      const length = data.readUInt32BE();
      const dataSeg = data.subarray(4);

      if (dataSeg.length === length) {
        joinedPayloads.push({ ...payload, data: dataSeg });
      } else {
        currentPayload = dataSeg;
        currentPayloadLength = length;
      }
    } else {
      const dataSeg = Buffer.concat([currentPayload, data]);
      if (dataSeg.length === currentPayloadLength) {
        joinedPayloads.push({ ...payload, data: dataSeg });
        currentPayload = null;
        currentPayloadLength = null;
      } else {
        currentPayload = dataSeg;
      }
    }
  });
  return joinedPayloads;
};

const recurseDefinitions = (
  nodes: (protobuf.Namespace | protobuf.Type | protobuf.Service | protobuf.ReflectionObject)[]
): protobuf.Type[] => {
  const types: protobuf.Type[] = nodes
    .map((node) => {
      if (node instanceof protobuf.Type) {
        return node;
      }
      if (node instanceof protobuf.Namespace) {
        return recurseDefinitions(node.nestedArray);
      }
      return null;
    })
    .filter((n): n is protobuf.Type[] => n !== null)
    .flat();
  return types;
};

const main = () => {
  const wsJson: any[] = jsonHandler.parse(readFileSync('dmx-upc.json', 'utf-8'), 'increment');
  outputJSONSync('deduped-dmx-upc.json', wsJson, { spaces: 2 });
  const payloads = wsJson
    .map(getTLSPayload)
    .filter((p): p is TLSPayload[] => p !== null)
    .flat();
  console.log(`${payloads.length} payloads found`);
  const joinedPayloads = payloadJoiner(payloads);
  outputJSONSync('tls-payloads.json', joinedPayloads, { spaces: 2 });
  const rawDecodedPayloads = joinedPayloads.map((p) => {
    const d = rawproto.getData(p.data);
    return {
      ...p,
      data: d,
    };
  });
  outputJSONSync('decoded-payloads.json', rawDecodedPayloads, {
    spaces: 2,
    replacer: jsonBufferReplacer,
  });

  const types = recurseDefinitions(packageDefinition.nestedArray);
  console.log(`resolved ${types.length} proto types`);
  const responses = joinedPayloads.flatMap((p) => {
    return types
      .map((type) => {
        try {
          return type.decode(p.data);
        } catch (err) {
          return null;
        }
      })
      .filter((d): d is protobuf.Message<any> => d !== null);
  });
  console.log(`Generated ${responses.length} responses`);
  outputJSONSync('decodes.json', responses, {
    spaces: 2,
    replacer: jsonBufferReplacer,
  });
};

main();
