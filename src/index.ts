/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-promise-executor-return */
import protobuf from 'protobufjs';
import glob from 'glob';
import { readFileSync, outputJSONSync } from 'fs-extra';
import jsonHandler from './util/json-dupe-parse'; // Handles duplicate JSON keys
import * as demux from './types/generated/proto/proto_demux/demux';

const DEMUX_HOST = 'dmx.upc.ubisoft.com';

const protoFiles = glob.sync('proto/**/*.proto');
console.log(`Loaded ${protoFiles.length} protos`);
const packageDefinition = protobuf.loadSync(protoFiles);

const demuxSchema = packageDefinition.lookup('mg.protocol.demux') as protobuf.Namespace;

const serviceMap: Record<string, protobuf.Namespace> = {
  utility_service: packageDefinition.lookup('mg.protocol.utility') as protobuf.Namespace,
  ownership_service: packageDefinition.lookup('mg.protocol.ownership') as protobuf.Namespace,
  denuvo_service: packageDefinition.lookup('mg.protocol.denuvo_service') as protobuf.Namespace,
  store_service: packageDefinition.lookup('mg.protocol.store') as protobuf.Namespace,
  friends_service: packageDefinition.lookup('mg.protocol.friends') as protobuf.Namespace,
  playtime_service: packageDefinition.lookup('mg.playtime') as protobuf.Namespace,
  party_service: packageDefinition.lookup('mg.protocol.party') as protobuf.Namespace,
  download_service: packageDefinition.lookup('mg.protocol.download') as protobuf.Namespace,
  client_configuration_service: packageDefinition.lookup(
    'mg.protocol.client_configuration'
  ) as protobuf.Namespace,
};

interface TLSPayload {
  data: Buffer;
  frame: number;
  direction: 'Upstream' | 'Downstream';
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
  const frame = parseInt(layers.frame['frame.number'], 10);

  let direction: 'Upstream' | 'Downstream' | null = null;
  if (wsPacket._source?.layers?.ip['ip.dst_host'] === DEMUX_HOST) {
    direction = 'Upstream';
  }
  if (wsPacket._source?.layers?.ip['ip.src_host'] === DEMUX_HOST) {
    direction = 'Downstream';
  }
  if (!direction) return null;

  const dataKeys = Object.keys(layers).filter((key) => key.match(/data\d*/));
  const payloads = dataKeys
    .map((key) => {
      const currentData = layers[key]?.['data.data'];
      if (!currentData) return null;
      return {
        frame,
        direction,
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

const decodeRequests = (payloads: TLSPayload[]): any[] => {
  const openRequests: Record<number, string> = {};
  const openConnections: Record<number, string> = {};
  const decodedDemux = payloads.map((payload) => {
    const schema = demuxSchema.lookupType(payload.direction);
    const body = schema.decode(payload.data) as unknown as demux.Upstream | demux.Downstream;
    if ('request' in body && body.request?.serviceRequest) {
      const { requestId } = body.request;
      const { data, service } = body.request.serviceRequest;
      const serviceSchema = serviceMap[service];
      if (!serviceSchema) throw new Error(`Missing service: ${service}`);
      const dataType = serviceSchema.lookupType(payload.direction);
      const decodedData = dataType.decode(data);
      openRequests[requestId] = service;
      body.request.serviceRequest.data = decodedData as never;
    }
    if ('response' in body && body.response?.serviceRsp) {
      const { requestId } = body.response;
      const { data } = body.response.serviceRsp;
      const serviceName = openRequests[requestId];
      const serviceSchema = serviceMap[serviceName];
      const dataType = serviceSchema.lookupType(payload.direction);
      const decodedData = dataType.decode(data);
      delete openRequests[requestId];
      body.response.serviceRsp.data = decodedData as never;
    }
    return body;
  });
  return decodedDemux;
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

  const decodedDemuxes = decodeRequests(joinedPayloads);
  console.log(`Generated ${decodedDemuxes.length} responses`);
  outputJSONSync('decodes.json', decodedDemuxes, {
    spaces: 2,
    replacer: jsonBufferReplacer,
  });
};

main();
