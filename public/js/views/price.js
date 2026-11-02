// A package's full price, crossed out diagonally, shown before the price it's
// sold at while packages are discounted (catalog.js listPrice). Screen
// readers hear "Was $29, now $14.50".
import { html } from "../core.js";
import { usd } from "../shared/catalog.js";

export const wasPrice = (p) =>
  p?.listPrice > p?.price ? html`<span class="price-was"><span class="sr-only">Was </span><del>${usd(p.listPrice)}</del><span class="sr-only">, now</span></span>` : "";
