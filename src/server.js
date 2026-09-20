import express from "express";
import cookieParser from "cookie-parser";
import {engine} from "express-handlebars";
import dotenv from "dotenv";
import path from "path";
import {fileURLToPath} from "url";
import helmet from "helmet";
import apiRoutes from "./routes/api.js";
import pageRoutes from "./routes/pages.js";
import {safeNext} from "./services/web-session.js";

dotenv.config();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const viewsDir=path.join(__dirname,"views");
app.engine("handlebars",engine({
  defaultLayout:"main",
  helpers:{
    eq:(a,b)=>String(a)===String(b),
    money:value=>(Number(value||0)/100).toLocaleString("es-ES",{style:"currency",currency:"EUR"}),
    decimal:value=>value===undefined?"":(Number(value)/100).toFixed(2),
    multiply:(a,b)=>Number(a)*Number(b),
    date:value=>new Date(value).toLocaleString("es-ES"),
    json:value=>JSON.stringify(value||{})
  },
  layoutsDir:path.join(viewsDir,"layouts"),
  partialsDir:path.join(viewsDir,"partials")
}));
app.set("view engine","handlebars");
app.set("views",viewsDir);
// MariaDB returns BIGINT identifiers as bigint, which JSON cannot serialize.
app.set("json replacer",(key,value)=>typeof value==="bigint"?value.toString():value);
app.use(helmet({contentSecurityPolicy:false,crossOriginOpenerPolicy:{policy:"same-origin-allow-popups"},referrerPolicy:{policy:"strict-origin-when-cross-origin"}}));
app.use(cookieParser());
app.use("/api/webhooks/delivery",express.raw({type:"application/json",limit:"100kb"}));
app.use(express.json({limit:"100kb"}));
app.use(express.urlencoded({extended:false,limit:"100kb"}));
app.use(express.static(path.join(__dirname,"../public")));

app.use("/api",apiRoutes);
app.use(pageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.status||500;
  if(status>=500)console.error("Request failed:",err.code||err.name);
  if(!req.path.startsWith("/api/")){
    const error=status>=500?"No se pudo completar la operación. Inténtalo de nuevo...":err.message;
    let back="/";try{const ref=new URL(req.get("referer"));if(ref.host===req.get("host"))back=safeNext(ref.pathname+ref.search)}catch{}
    return res.status(status).render("error",{error,back,title:"Error"});
  }
  res.status(status).json({error:status>=500?"No se pudo completar la operación. Inténtalo de nuevo..":err.message});
});
app.listen(Number(process.env.PORT||3000),()=>console.log(`Pizzeria v0.2: http://localhost:${process.env.PORT||3000}`));
