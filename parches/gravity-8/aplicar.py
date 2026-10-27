import sys
p=sys.argv[1]
s=open(p,encoding='utf8').read()

helper='''// Gemini y otros modelos omiten los campos que pueden ser null; el esquema estricto los exige.
var aceptaNulo = (e) => !!e && (e.type === "null" || Array.isArray(e.type) && e.type.includes("null") || [...e.anyOf ?? [], ...e.oneOf ?? []].some(aceptaNulo));
var sinNulo = (e) => e?.anyOf || e?.oneOf ? [...e.anyOf ?? [], ...e.oneOf ?? []].find((x) => x?.type !== "null") ?? e : e;
function completarNulos(esquema2, valor) {
  if (!esquema2?.properties || !valor || typeof valor !== "object" || Array.isArray(valor)) return valor;
  const salida = { ...valor };
  for (const [k, sub] of Object.entries(esquema2.properties)) {
    if (salida[k] === void 0) {
      if (esquema2.required?.includes(k) && aceptaNulo(sub)) salida[k] = null;
    } else if (salida[k] && typeof salida[k] === "object") {
      salida[k] = completarNulos(sinNulo(sub), salida[k]);
    }
  }
  return salida;
}
var entradaDeLlamada = (p, nombre, entrada) => completarNulos(p.herramientas.find((h) => h.nombre === nombre)?.esquema, entrada);
function limpiarEsquema('''
a='function limpiarEsquema('
assert s.count(a)==1
s=s.replace(a,helper)

g='bloques.push({ type: "tool_use", id: id2, name: String(llamada.name), input: llamada.args ?? {} });'
assert s.count(g)==1
s=s.replace(g,'bloques.push({ type: "tool_use", id: id2, name: String(llamada.name), input: entradaDeLlamada(p, String(llamada.name), llamada.args ?? {}) });')

o='bloques.push({ type: "tool_use", id: nuevoId2("toolu_"), name: String(f.name), input: entrada });'
assert s.count(o)==1
s=s.replace(o,'bloques.push({ type: "tool_use", id: nuevoId2("toolu_"), name: String(f.name), input: entradaDeLlamada(p, String(f.name), entrada) });')
open(p,'w',encoding='utf8').write(s)
