import json, math, sys, os
d=json.load(open(sys.argv[1] if len(sys.argv) > 1 else "f1-circuits.geojson"))
want={'monza':'it-1922','monaco':'mc-1929','silverstone':'gb-1948','spa':'be-1925','suzuka':'jp-1962','interlagos':'br-1940','barcelona':'es-1991','redbullring':'at-1969','cota':'us-2012','yasmarina':'ae-2009','marinabay':'sg-2008','hungaroring':'hu-1986','montreal':'ca-1978','albertpark':'au-1953','mexico':'mx-1962'}
reverse={'marinabay'}
by={f['properties']['id']:f for f in d['features']}
out=['// Trazados reales: centerlines GeoJSON de bacinger/f1-circuits (MIT, (c) 2019-2025 Tomislav Bacinger).','// Convertidos a metros locales: x = este, z = sur. Generado por tools/gen-circuits.py.','export const CIRCUIT_GEO = {']
for key,id in want.items():
  c=by[id]['geometry']['coordinates']
  lat0=sum(p[1] for p in c)/len(c); lon0=sum(p[0] for p in c)/len(c); R=6371000
  pts=[((p[0]-lon0)*math.cos(math.radians(lat0))*R*math.pi/180, -(p[1]-lat0)*R*math.pi/180) for p in c]
  if pts[0]==pts[-1]: pts=pts[:-1]
  if key in reverse: pts=[pts[0]]+pts[1:][::-1]
  flat=','.join(f'{round(x,1)},{round(z,1)}' for x,z in pts)
  out.append(f"  {key}: {{ source: '{id}', lat: {round(lat0,5)}, lon: {round(lon0,5)}, pts: [{flat}] }},")
out.append('};')
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "data", "circuitGeo.js"), "w").write('\n'.join(out)+'\n')
