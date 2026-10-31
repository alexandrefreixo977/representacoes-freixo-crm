export type CatalogFamily={manufacturer_id:string;name:string};
export function familiesForManufacturer(rows:CatalogFamily[],manufacturerId:string):string[]{
 if(!manufacturerId)return [];
 const names=new Map<string,string>();
 for(const row of rows){if(row.manufacturer_id!==manufacturerId)continue;const name=row.name.trim();if(name&&!names.has(name.toLocaleLowerCase('pt-PT')))names.set(name.toLocaleLowerCase('pt-PT'),name);}
 return [...names.values()].sort((a,b)=>a.localeCompare(b,'pt-PT'));
}
