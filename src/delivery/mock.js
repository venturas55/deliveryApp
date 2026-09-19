import {randomUUID} from "node:crypto";
const steps={
  delivery_requested:{status:"courier_assigned",providerStatus:"COURIER_ASSIGNED"},
  courier_assigned:{status:"out_for_delivery",providerStatus:"PICKED_UP"},
  out_for_delivery:{status:"delivered",providerStatus:"DELIVERED"}
};
export const mockDelivery={
  name:"mock",
  async quote(order){return {provider:"mock",quoteId:`MOCK-${randomUUID()}`,feeCents:Number(process.env.DELIVERY_BASE_CENTS||399),etaMinutes:30}},
  async create(order,quote){return {provider:"mock",providerOrderId:`MOCK-${order.id}`,providerStatus:"CREATED"}},
  next(status){return steps[status]||null}
};
