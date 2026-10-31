import type { Matrix } from './engine';

export type Location = { latitude: number; longitude: number };
export type Geocode = { placeId: string; location: Location; address: string; precise: boolean };
export interface MapsProvider {
  geocode(address: string): Promise<Geocode[]>;
  matrix(points: Location[]): Promise<Matrix>;
  route(points: Location[]): Promise<{ encodedPolyline: string; meters: number; seconds: number }>;
}
export function validateLocation(point: Location) {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude)>90 || Math.abs(point.longitude)>180) throw new Error('Coordenadas inválidas.');
  return point;
}
export class GoogleMapsProvider implements MapsProvider {
  constructor(private key: string, private request: typeof fetch = fetch) { if(!key) throw new Error('Google Maps ainda não configurado.'); }
  private async call(url: string, body?: unknown, fields?: string) {
    const response = await this.request(url, { method:body?'POST':'GET', cache:'no-store', signal:AbortSignal.timeout(20000), headers:body?{'Content-Type':'application/json','X-Goog-Api-Key':this.key,'X-Goog-FieldMask':fields!}:undefined, ...(body?{body:JSON.stringify(body)}:{}) });
    if(!response.ok) throw new Error(response.status===429?'Limite do Google Maps atingido. Tente mais tarde.':'Google Maps indisponível. Não foi possível validar a rota.');
    return response.json();
  }
  async geocode(address: string): Promise<Geocode[]> {
    if(address.trim().length<8 || address.length>500) throw new Error('Indique uma morada completa.');
    const query = new URLSearchParams({ address, key:this.key, language:'pt-PT', components:'country:PT' });
    const data = await this.call(`https://maps.googleapis.com/maps/api/geocode/json?${query}`);
    if(data.status==='ZERO_RESULTS') return [];
    if(data.status!=='OK') throw new Error('Não foi possível validar a morada no Google Maps.');
    return data.results.slice(0,5).map((r:any)=>({ placeId:r.place_id, address:r.formatted_address, location:validateLocation({latitude:r.geometry.location.lat,longitude:r.geometry.location.lng}), precise:!r.partial_match && ['ROOFTOP','RANGE_INTERPOLATED'].includes(r.geometry.location_type) && r.types.some((t:string)=>['street_address','premise','subpremise'].includes(t)) }));
  }
  private waypoint(point: Location) { return {location:{latLng:validateLocation(point)}}; }
  async matrix(points: Location[]): Promise<Matrix> {
    // A 20x20 matrix costs 400 elements. Never fan out unbounded requests.
    if(points.length<2 || points.length>20) throw new Error('Selecione entre 2 e 20 localizações por cálculo.');
    const data = await this.call('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{origins:points.map(p=>({waypoint:this.waypoint(p)})),destinations:points.map(p=>({waypoint:this.waypoint(p)})),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'},'originIndex,destinationIndex,status,condition,distanceMeters,duration');
    const matrix: Matrix = points.map(()=>points.map(()=>null));
    for(const row of data) {
      const i=row.originIndex??0,j=row.destinationIndex??0;
      if(!Number.isInteger(i)||!Number.isInteger(j)||i<0||j<0||i>=points.length||j>=points.length) continue;
      const seconds=typeof row.duration==='string'&&/^\d+(\.\d+)?s$/.test(row.duration)?Number(row.duration.slice(0,-1)):NaN;
      if(row.condition==='ROUTE_EXISTS' && !(row.status?.code) && Number.isFinite(seconds) && seconds>=0 && Number.isFinite(row.distanceMeters) && row.distanceMeters>=0) matrix[i][j]={seconds,meters:row.distanceMeters};
      else if(i===j && row.condition==='ROUTE_EXISTS' && !row.status?.code) matrix[i][j]={seconds:0,meters:0};
    }
    return matrix;
  }
  async route(points: Location[]) {
    if(points.length<2 || points.length>20) throw new Error('Número de paragens inválido.');
    const data=await this.call('https://routes.googleapis.com/directions/v2:computeRoutes',{origin:this.waypoint(points[0]),destination:this.waypoint(points.at(-1)!),intermediates:points.slice(1,-1).map(p=>this.waypoint(p)),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE'},'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline');
    const route=data.routes?.[0];
    if(!route?.polyline?.encodedPolyline || !/^\d+(\.\d+)?s$/.test(route.duration) || !Number.isFinite(route.distanceMeters)) throw new Error('Não existe percurso rodoviário validado.');
    return {encodedPolyline:route.polyline.encodedPolyline,meters:route.distanceMeters,seconds:Number(route.duration.slice(0,-1))};
  }
}
