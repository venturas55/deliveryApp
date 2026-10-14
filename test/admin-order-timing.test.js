import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import vm from "node:vm";
import Handlebars from "handlebars";
import {presentOrder} from "../src/services/order-presenter.js";

test("ADMIN web list and detail distinguish ASAP and scheduled orders", () => {
  const handlebars=Handlebars.create();
  handlebars.registerHelper("eq",(a,b)=>a===b);
  handlebars.registerHelper("money",value=>String(value||0));
  handlebars.registerHelper("date",value=>String(value||""));
  handlebars.registerHelper("multiply",(a,b)=>a*b);
  handlebars.registerPartial("csrf","");
  for(const file of ["orders","order"]) {
    const render=handlebars.compile(readFileSync(`src/views/admin/${file}.handlebars`,"utf8"));
    for(const scheduled_for of [null,"2026-10-14T17:30:00Z"]) {
      const order=presentOrder({id:42,status:"new",scheduled_for});
      const html=render({order,orders:[order]});
      assert.match(html,/Hora solicitada/);
      if(scheduled_for) {
        assert.match(html,/>Programado</);
        assert.match(html,/14\/10\/2026 19:30/);
        assert.match(html,/datetime="2026-10-14T17:30:00Z"/);
        assert.doesNotMatch(html,/Lo antes posible/);
      } else {
        assert.match(html,/>Lo antes posible</);
        assert.doesNotMatch(html,/>Programado</);
      }
    }
  }
});

test("ADMIN React order cards render schedule with or without API label", () => {
  const nativeRequire=createRequire(resolve("react-native/package.json"));
  const babel=nativeRequire("@babel/core");
  const source=readFileSync("react-native/src/admin/Orders.js","utf8");
  const ast=nativeRequire("@babel/parser").parse(source,{sourceType:"module",plugins:["jsx"]});
  const declaration=ast.program.body.find(node=>node.type==="FunctionDeclaration"&&node.id.name==="OrderTiming");
  const code=babel.transformSync(source.slice(declaration.start,declaration.end),{
    configFile:false,babelrc:false,plugins:[nativeRequire.resolve("@babel/plugin-transform-react-jsx")],
  }).code;
  const context={
    React:{createElement:(_type,_props,...children)=>children.flat().filter(value=>value!==false&&value!=null).join(" ")},
    View:"View",Text:"Text",useTheme:()=>({color:value=>value}),useStyles:()=>({}),
    t:(key,values={})=>key.replace(/\{\{(\w+)\}\}/g,(_match,name)=>values[name]),
  };
  vm.createContext(context);
  vm.runInContext(code+"\nthis.render=OrderTiming;",context);
  assert.match(context.render({order:{}}),/Lo antes posible/);
  for(const scheduleLabel of [undefined,"14/10/2026 19:30"]) {
    const text=context.render({order:{scheduled_for:"2026-10-14T17:30:00Z",scheduleLabel}});
    assert.match(text,/Programado/);
    assert.match(text,/19:30/);
    assert.match(text,/Europe\/Madrid/);
    assert.doesNotMatch(text,/Lo antes posible/);
  }
});
