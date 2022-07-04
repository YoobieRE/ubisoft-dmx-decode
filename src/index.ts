/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle */
import protobuf from 'protobufjs';
import glob from 'glob';
import { readFileSync, outputJSONSync } from 'fs-extra';
import yaml from 'yaml';
import * as demux from './generated/proto/proto_demux/demux';

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
  download_service: packageDefinition.lookup('mg.protocol.download_service') as protobuf.Namespace,
  client_configuration_service: packageDefinition.lookup(
    'mg.protocol.client_configuration'
  ) as protobuf.Namespace,
};

interface TLSPayload {
  length: number;
  data: Buffer;
  index: number;
  direction: 'Upstream' | 'Downstream';
}

export interface Packet {
  packet: number;
  peer: number;
  index: number;
  timestamp: number;
  data: string;
}

export interface Peer {
  peer: number;
  host: string;
  port: number;
}
export interface TLSStreamExport {
  peers: Peer[];
  packets: Packet[];
}

const decodeRequests = (payloads: TLSPayload[]): any[] => {
  const openServiceRequests = new Map<number, string>();
  const openConnectionRequests = new Map<number, string>();
  const openConnections = new Map<number, string>();
  const decodedDemux = payloads.map((payload) => {
    const schema = demuxSchema.lookupType(payload.direction);
    console.log(`${payload.direction} index ${payload.index}:`);
    if (payload.data.length !== payload.length) {
      console.warn(
        `Buffer length of ${payload.data.length} does not match expected length of ${payload.length}`
      );
      return null;
    }
    const body = schema.decode(payload.data) as
      | (protobuf.Message & demux.Upstream)
      | (protobuf.Message & demux.Downstream);

    // console.log(body);

    // Service requests/responses
    if ('request' in body && body.request?.serviceRequest) {
      const { requestId } = body.request;
      const { data, service } = body.request.serviceRequest;
      const serviceSchema = serviceMap[service];
      if (!serviceSchema) {
        console.warn(`Missing service: ${service}`);
        return null;
      }
      const dataType = serviceSchema.lookupType(payload.direction);
      const decodedData = dataType.decode(data) as never;
      openServiceRequests.set(requestId, service);
      const updatedBody = body.toJSON();
      updatedBody.request.serviceRequest.data = decodedData;
      return updatedBody;
    }
    if ('response' in body && body.response?.serviceRsp) {
      const { requestId } = body.response;
      const { data } = body.response.serviceRsp;
      const serviceName = openServiceRequests.get(requestId) as string;
      const serviceSchema = serviceMap[serviceName];
      const dataType = serviceSchema.lookupType(payload.direction);
      const decodedData = dataType.decode(data) as never;
      openServiceRequests.delete(requestId);
      const updatedBody = body.toJSON();
      updatedBody.response.serviceRsp.data = decodedData;
      return updatedBody;
    }

    // Connection requests/responses
    if ('request' in body && body.request?.openConnectionReq) {
      const { requestId } = body.request;
      const { serviceName } = body.request.openConnectionReq;
      openConnectionRequests.set(requestId, serviceName);
    }
    if ('response' in body && body.response?.openConnectionRsp) {
      const { requestId } = body.response;
      const { connectionId } = body.response.openConnectionRsp;
      const serviceName = openConnectionRequests.get(requestId) as string;
      openConnections.set(connectionId, serviceName);
      openConnectionRequests.delete(requestId);
    }

    // Connection pushes/closed
    if ('push' in body && body.push?.data) {
      const { connectionId, data } = body.push.data;
      const serviceName = openConnections.get(connectionId) as string;
      const serviceSchema = serviceMap[serviceName];
      if (!serviceSchema) {
        console.warn(`Missing service: ${serviceName}`);
        return null;
      }
      const dataType = serviceSchema.lookupType(payload.direction);
      const trimmedPush = data.subarray(4); // First 4 bytes are length
      const decodedData = dataType.decode(trimmedPush) as never;
      const updatedBody = body.toJSON();
      updatedBody.push.data.data = decodedData;
      return updatedBody;
    }
    if ('push' in body && body.push?.connectionClosed) {
      const { connectionId } = body.push.connectionClosed;
      openConnections.delete(connectionId);
    }
    return body.toJSON();
  });
  return decodedDemux;
};

const main = () => {
  const tlsStream: TLSStreamExport = yaml.parse(readFileSync('tls-stream.yml', 'utf-8'), {
    resolveKnownTags: false, // wireshark of course spits out invalid yaml binary, so we don't resolve it here
    logLevel: 'error',
  });
  outputJSONSync('parsed-tls-stream.json', tlsStream, { spaces: 2 });
  const upstreamPeer = tlsStream.peers.find((peer) => peer.port > 0)?.peer || 0;
  const mappedPayloads: TLSPayload[] = tlsStream.packets.map((packet) => {
    const b64Segments = packet.data.split(/=+/); // If there's padding, we need to parse each b64 string individually
    const joinedBinary = b64Segments.reduce((acc, curr) => {
      const segmentBuf = Buffer.from(curr, 'base64');
      return Buffer.concat([acc, segmentBuf]);
    }, Buffer.alloc(0));
    const length = joinedBinary.readUInt32BE();
    const dataSeg = joinedBinary.subarray(4);
    return {
      length,
      data: dataSeg,
      index: packet.index,
      direction: packet.peer === upstreamPeer ? 'Upstream' : 'Downstream',
    };
  });
  const decodedDemuxes = decodeRequests(mappedPayloads);
  console.log(`Generated ${decodedDemuxes.length} responses`);
  outputJSONSync('decodes.json', decodedDemuxes, {
    spaces: 2,
  });
};

main();
