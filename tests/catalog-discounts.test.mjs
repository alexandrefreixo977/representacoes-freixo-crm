import test from "node:test";import assert from "node:assert/strict";import {calculateSuccessiveDiscounts,formatDiscounts,parseDiscounts} from "../app/catalog-discounts.ts";
test("calcula 40%",()=>assert.equal(calculateSuccessiveDiscounts(100,[40]).netPrice,60));
test("calcula 40% + 10% sucessivamente",()=>assert.deepEqual(calculateSuccessiveDiscounts(100,[40,10]),{netPrice:54,effectiveDiscount:46,discounts:[40,10]}));
test("calcula 40% + 10% + 5%",()=>assert.equal(calculateSuccessiveDiscounts(100,[40,10,5]).netPrice,51.3));
test("preserva representação comercial",()=>{assert.deepEqual(parseDiscounts("40% + 10%"),[40,10]);assert.equal(formatDiscounts([40,10]),"40% + 10%")});

