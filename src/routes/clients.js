import {Router} from "express";
import {customerAuth} from "../auth.js";
import * as operations from "../controllers/clients.js";
export const clientApiRoutes=Router();
clientApiRoutes.get("/public/menu",async(req,res)=>res.status(200).json(await operations.menu(req)));
clientApiRoutes.post("/orders",customerAuth,async(req,res)=>res.status(201).json(await operations.createOrder(req)));
clientApiRoutes.get("/customer/orders",customerAuth,async(req,res)=>res.status(200).json(await operations.customerOrders(req)));
clientApiRoutes.get(["/customer/orders/:id","/orders/:id/public"],customerAuth,async(req,res)=>res.status(200).json(await operations.customerOrder(req)));
