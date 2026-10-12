import { query } from "../db.js";
import { getRestaurant } from "./restaurants.js";
import { httpError } from "./http-error.js";

// Historical orders remain readable during a mixed-version deployment.
export const customerMembership = (customer = "c", restaurant = "?") =>
  `(EXISTS (SELECT 1 FROM restaurant_customers rc WHERE rc.customer_id=${customer}.id AND rc.restaurant_id=${restaurant}) OR EXISTS (SELECT 1 FROM orders membership_order WHERE membership_order.customer_id=${customer}.id AND membership_order.restaurant_id=${restaurant}))`;

export async function associateCustomer(customerId, restaurantId, connection = { query }) {
  await connection.query("INSERT IGNORE INTO restaurant_customers (restaurant_id,customer_id) VALUES(?,?)", [restaurantId, customerId]);
}

export async function customerRestaurant(id) {
  const restaurant = await getRestaurant(id);
  if (!restaurant) throw httpError(404, "Restaurante no encontrado");
  return restaurant.id;
}
