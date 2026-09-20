import {Router} from "express";
import {query} from "../db.js";
import {getRestaurant} from "../services/restaurants.js";
import {webSession} from "../services/web-session.js";
import clientPages from "./client-pages.js";
import adminPages from "./admin-pages.js";
const router=Router();

router.use(webSession);
router.use(async(req,res,next)=>{
  const isAdmin=req.path==="/admin.html"||req.path==="/admin"||req.path.startsWith("/admin/");
  let restaurant;
  if(isAdmin&&req.user)restaurant=(await query("SELECT name FROM restaurants WHERE id=?",[req.user.restaurant_id]))[0];
  else restaurant=await getRestaurant("demo");
  const name=restaurant?.name||process.env.RESTAURANT_NAME||"Restaurante";
  Object.assign(res.locals,{clientArea:!isAdmin,adminArea:isAdmin,restaurantName:name,heading:name,brandInitial:name[0],title:name});
  next();
});

router.use(clientPages);
router.use(adminPages);
export default router;
