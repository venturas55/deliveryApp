import {mockDelivery} from "./mock.js";
import {uberDelivery} from "./uber.js";
export function getDeliveryProvider(){return process.env.DELIVERY_PROVIDER==="uber"?uberDelivery:mockDelivery}