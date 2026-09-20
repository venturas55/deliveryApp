import {getDeliveryProviderConfig} from "../services/delivery-config.js";
import {createGlovoDelivery} from "./glovo.js";
import {mockDelivery} from "./mock.js";
import {createUberDelivery} from "./uber.js";

export function getDeliveryProvider(){return process.env.DELIVERY_PROVIDER==="uber"?null:mockDelivery}

export async function getConfiguredDeliveryProviders(restaurantId){
  if(process.env.DELIVERY_PROVIDER==="mock")return [mockDelivery];
  const result=[];
  for(const provider of ["uber","glovo"]){
    const config=await getDeliveryProviderConfig(restaurantId,provider);
    if(!config.enabled)continue;
    result.push(provider==="uber"?createUberDelivery(config):createGlovoDelivery(config));
  }
  return result;
}

export async function getConfiguredDeliveryProvider(restaurantId,name){
  if(name==="mock"&&process.env.DELIVERY_PROVIDER==="mock")return mockDelivery;
  const providers=await getConfiguredDeliveryProviders(restaurantId);
  const provider=providers.find(candidate=>candidate.name===name);
  if(!provider)throw new Error("Proveedor no activo o no configurado");
  return provider;
}
