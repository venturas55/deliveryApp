export const mockDelivery={
 async quote(order){return {provider:"mock",quoteId:`MOCK-${Date.now()}`,feeCents:Number(process.env.DELIVERY_BASE_CENTS||399),etaMinutes:30}},
 async create(order,quote){return {provider:"mock",providerOrderId:`MOCK-${order.id}`,providerStatus:"CREATED"}}
};