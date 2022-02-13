declare module 'rawproto' {
  export function getData(buffer: Buffer, stringMode?: 'auto' | 'string' | 'binary'): any;
  export function getProto(buffer: Buffer, stringMode?: 'auto' | 'string' | 'binary'): any;
}
