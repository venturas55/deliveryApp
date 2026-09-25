import {getDeliveryProviderConfig} from "../services/delivery-config.js";
import {createGlovoDelivery} from "./glovo.js";
import {createJustEatJetGoDelivery} from "./just-eat-jet-go.js";
import {mockDelivery} from "./mock.js";
import {createUberDelivery} from "./uber.js";

export function getDeliveryProvider(){return process.env.DELIVERY_PROVIDER==="uber"?null:mockDelivery}

export async function getConfiguredDeliveryProviders(restaurantId){
  if(process.env.DELIVERY_PROVIDER==="mock")return [mockDelivery];
  const result=[];
  for(const provider of ["uber","glovo","just_eat_jet_go"]){
    const config=await getDeliveryProviderConfig(restaurantId,provider);
    if(!config.enabled)continue;
    result.push(provider==="uber"?createUberDelivery(config):provider==="glovo"?createGlovoDelivery(config):createJustEatJetGoDelivery(config));
  }
  return result;
}

export async function getConfiguredDeliveryProvider(restaurantId,name,allowDisabled=false){
  if(name==="mock"&&process.env.DELIVERY_PROVIDER==="mock")return mockDelivery;
  if(allowDisabled){
    const config=await getDeliveryProviderConfig(restaurantId,name);
    return name==="uber"?createUberDelivery(config):name==="glovo"?createGlovoDelivery(config):createJustEatJetGoDelivery(config);
  }
  const providers=await getConfiguredDeliveryProviders(restaurantId);
  const provider=providers.find(candidate=>candidate.name===name);
  if(!provider)throw new Error("Proveedor no activo o no configurado");
  return provider;
}
