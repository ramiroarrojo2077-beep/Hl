import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../hooks/motion'

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'

/* Raymarching de una escultura 3D (toroide + núcleo orgánico) con reflejos iridiscentes. */
const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime,uScroll,uShape;uniform vec2 uMouse;uniform vec3 uAccent;
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float map(vec3 p){
  p.yz*=rot(.5+uTime*.19+uScroll*2.4+uMouse.y*.5);
  p.xz*=rot(uTime*.23+uMouse.x*.8+uScroll*1.2);
  vec2 q=vec2(length(p.xz)-1.05,p.y);
  float torus=length(q)-.3;
  float w=.07*sin(p.x*5.+uTime*1.1)*sin(p.y*5.+uTime*.9)*sin(p.z*5.+uTime*.7);
  float core=length(p)-(.58+uShape*.25)-w;
  float box=length(max(abs(p)-vec3(.62),0.))-.12;
  return smin(torus,mix(core,box,uShape*.6),.4);
}
vec3 nrm(vec3 p){vec2 e=vec2(.0015,0.);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec3 ro=vec3(0.,0.,4.3),rd=normalize(vec3(uv,-1.55));
  float d=0.,mh=9.;bool hit=false;
  for(int i=0;i<72;i++){float h=map(ro+rd*d);mh=min(mh,h);if(h<.0012){hit=true;break;}d+=h;if(d>7.)break;}
  vec3 col=vec3(0.);float a=0.;
  if(hit){
    vec3 p=ro+rd*d,n=nrm(p),r=reflect(rd,n);
    float fr=pow(1.-max(dot(n,-rd),0.),3.);
    vec3 env=mix(vec3(.015,.02,.04),uAccent*1.25,smoothstep(-.3,.95,r.y));
    env+=vec3(1.)*pow(max(dot(r,normalize(vec3(.55,.75,.45))),0.),28.)*1.6;
    env+=uAccent*pow(max(dot(r,normalize(vec3(-.8,-.2,.3))),0.),6.)*.5;
    vec3 ir=.5+.5*cos(6.2831*(fr*.7+vec3(0.,.33,.67))+uTime*.25);
    float df=max(dot(n,normalize(vec3(.4,.9,.6))),0.);
    col=vec3(.02)+df*uAccent*.18+env*.85+ir*fr*.55;
    a=1.;
  }else{
    float g=exp(-mh*7.)*.35*smoothstep(.75,.3,length(uv));col=uAccent*g;a=g;
  }
  gl_FragColor=vec4(col,a);
}`

interface Props {
  accent?: string
  /** 0 = orgánico, 1 = más geométrico */
  shape?: number
  className?: string
  label?: string
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)

/** Objeto 3D en tiempo real (WebGL). Reacciona al cursor y al scroll; se detiene fuera de pantalla. */
export function Object3D({ accent = '#5B8CFF', shape = 0, className = '', label = 'Escultura 3D interactiva' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const gl = c?.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true })
    if (!c || !gl) {
      c?.classList.add('is-fallback')
      return
    }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      c.classList.add('is-fallback')
      return
    }
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const uRes = u('uRes'), uTime = u('uTime'), uScroll = u('uScroll'), uMouse = u('uMouse')
    gl.uniform3fv(u('uAccent'), hex(accent))
    gl.uniform1f(u('uShape'), shape)

    const reduced = prefersReducedMotion()
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 }
    let raf = 0, visible = true
    const t0 = performance.now()
    const resize = () => {
      const s = Math.min(1.5, window.devicePixelRatio || 1) * 0.8
      c.width = Math.max(1, Math.round(c.clientWidth * s))
      c.height = Math.max(1, Math.round(c.clientHeight * s))
      gl.viewport(0, 0, c.width, c.height)
      gl.uniform2f(uRes, c.width, c.height)
    }
    const frame = (now: number) => {
      mouse.x += (mouse.tx - mouse.x) * 0.06
      mouse.y += (mouse.ty - mouse.y) * 0.06
      gl.uniform1f(uTime, reduced ? 2 : (now - t0) / 1000)
      gl.uniform1f(uScroll, Math.min(1.5, window.scrollY / window.innerHeight))
      gl.uniform2f(uMouse, mouse.x, mouse.y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = visible && !reduced ? requestAnimationFrame(frame) : 0
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const move = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2
      if (reduced) kick()
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) kick()
    })
    const ro = new ResizeObserver(() => {
      resize()
      kick()
    })
    ro.observe(c)
    io.observe(c)
    window.addEventListener('pointermove', move, { passive: true })
    if (reduced) window.addEventListener('scroll', kick, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('scroll', kick)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [accent, shape])
  return <canvas ref={ref} className={`obj3d ${className}`} role="img" aria-label={label} />
}
