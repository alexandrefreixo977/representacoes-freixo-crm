export function normalizeDiscounts(values:number[]){return values.map(Number).filter(value=>Number.isFinite(value)&&value>=0&&value<=100)}
export function calculateSuccessiveDiscounts(price:number,discounts:number[]){const clean=normalizeDiscounts(discounts);const net=clean.reduce((value,discount)=>value*(1-discount/100),Number(price)||0);return {netPrice:Math.round(net*100)/100,effectiveDiscount:price>0?Math.round((1-net/price)*10000)/100:0,discounts:clean}}
export function parseDiscounts(value:string){return normalizeDiscounts(value.split(/[+;,]/).map(item=>Number(item.trim().replace("%",""))))}
export function formatDiscounts(values:number[]){return normalizeDiscounts(values).map(value=>`${new Intl.NumberFormat("pt-PT",{maximumFractionDigits:2}).format(value)}%`).join(" + ")}

