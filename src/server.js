import express from "express";
import cookieParser from "cookie-parser";
import {engine} from "express-handlebars";
import dotenv from "dotenv";
import path from "path";
import {fileURLToPath} from "url";
import helmet from "helmet";
import apiRoutes from "./routes/api.js";
import {adminPageRoutes} from "./routes/admin.js";
import {clientPageRoutes} from "./routes/clients.js";

dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const viewsDir=path.join(__dirname,"views");
app.engine("handlebars",engine({
  defaultLayout:"main",
  layoutsDir:path.join(viewsDir,"layouts"),
  partialsDir:path.join(viewsDir,"partials")
}));
app.set("view engine","handlebars");
app.set("views",viewsDir);
// MariaDB returns BIGINT identifiers as bigint, which JSON cannot serialize.
app.set("json replacer",(key,value)=>typeof value==="bigint"?value.toString():value);
app.use(helmet({contentSecurityPolicy:false,crossOriginOpenerPolicy:{policy:"same-origin-allow-popups"},referrerPolicy:{policy:"strict-origin-when-cross-origin"}}));
app.use(cookieParser());
app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"../public")));

app.use("/api",apiRoutes);
app.use(adminPageRoutes);
app.use(clientPageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.status||500;
  if(status>=500)console.error("Request failed:",err.code||err.name);
  res.status(status).json({error:status>=500?"No se pudo completar la operación. Inténtalo de nuevo.":err.message});
});
app.listen(Number(process.env.PORT||3000),()=>console.log(`Pizzeria v0.2: http://localhost:${process.env.PORT||3000}`));
