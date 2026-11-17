// The visuals' fragment shader: the original prototype's four scenes, plus a
// near-static Ember scene for eyes-closed sessions. One shader, scene chosen
// by uniform; scenes cross-fade by mixing two scene evaluations.

export const SCENES = ['Chrysanthemum', 'The Tunnel', 'Liquid Jewel', 'Infinite Lattice', 'Ember'] as const;

export const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

export const FRAG = `precision highp float;
uniform vec2 R;uniform float T,mixv,sa,sb,bass,hi,fade,bright,sat;
#define TAU 6.2831853
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 pal(float t){vec3 a=.5+.5*cos(TAU*(t+vec3(0.,.33,.67)));vec3 b=.5+.5*cos(TAU*(t+vec3(0.,.15,.3)+.55));return mix(a,b,.5+.5*sin(T*.017));}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=rot(.6);for(int i=0;i<5;i++){v+=a*noise(p);p=m*p*2.03;a*=.5;}return v;}
vec2 kal(vec2 p,float n){float r=length(p),a=atan(p.y,p.x),s=TAU/n;a=mod(a+s*.5,s)-s*.5;a=abs(a);return vec2(cos(a),sin(a))*r;}
vec3 s0(vec2 p,float t){
  p*=1.5+.35*sin(t*.07);p=kal(rot(t*.03)*p,8.);
  vec2 c=vec2(.78+.07*sin(t*.11),.52+.07*cos(t*.089));vec3 col=vec3(0);
  for(int i=0;i<9;i++){p=abs(p)/clamp(dot(p,p),.05,4.)-c;float d=length(p);col+=pal(float(i)*.09+t*.02+d*.15)*exp(-d*2.)*.36;}
  return col;}
vec3 s1(vec2 p,float t){
  p=rot(t*.05)*p;float r=length(p)+1e-3,a=atan(p.y,p.x);
  vec2 u=vec2(a/TAU*8.,log(r)*1.6-t*.28);u.x+=.35*sin(u.y*1.1+t*.2);
  vec2 g=fract(u)-.5,id=floor(u);float h=h21(id+.5);
  float d=abs(length(g)-.28-.06*sin(t*.5+h*6.))-.035;float e=abs(max(abs(g.x),abs(g.y))-.47);
  vec3 col=pal(h*.3+u.y*.06+t*.03)*((1.-smoothstep(0.,.05,d))+exp(-max(d,0.)*18.)*.35);
  col+=pal(u.y*.1+.5)*exp(-e*40.)*.45;col*=smoothstep(.0,.35,r);col+=pal(t*.05+.2)*.06/(r+.08);
  return col;}
vec3 s2(vec2 p,float t){
  p=kal(rot(-t*.02)*p,6.)*1.7;
  vec2 q=vec2(fbm(p+t*.05),fbm(p+vec2(5.2,1.3)-t*.04));
  vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.07),fbm(p+3.*q+vec2(8.3,2.8)));
  float f=fbm(p+3.*r);vec3 col=pal(f*1.3+length(q)*.6+t*.02)*(.12+f*1.25);
  col+=pal(r.x+.3)*pow(f,3.)*2.;return col;}
vec4 hx(vec2 p){vec2 s=vec2(1.,1.7320508),h=s*.5;vec2 a=mod(p,s)-h,b=mod(p-h,s)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;return vec4(g,p-g);}
vec3 s3(vec2 p,float t){
  vec3 col=vec3(0);float z=fract(t*.035);
  for(int i=0;i<4;i++){
    float fi=float(i)+1.-z;float w=sin(3.14159*fi/4.);
    vec2 q=rot(fi*.5)*p*pow(2.6,fi)*.45;vec4 h=hx(q);vec2 g=h.xy;
    float d1=abs(length(g)-.5),d2=abs(length(g)-.22-.05*sin(t*.3+fi*2.));
    float hd=abs(.5-max(dot(abs(g),vec2(.5,.8660254)),abs(g.x)));
    vec3 c=pal(fi*.23+t*.02+h21(h.zw)*.15);
    col+=c*w*(exp(-d1*28.)*.55+exp(-d2*36.)*.4+exp(-hd*50.)*.3);
  }return col;}
// Ember: a dim, warm glow that breathes once every twenty seconds. For eyes-closed sits.
vec3 s4(vec2 p,float t){
  float r=length(p*vec2(1.,1.15));
  float br=.5+.5*sin(t*.31);
  vec3 warm=vec3(.9,.38,.14);
  float core=exp(-r*r*(5.-1.2*br));
  float haze=fbm(p*1.3+vec2(t*.01,-t*.013))*.35;
  return warm*(core*.42+haze*core*.6)+vec3(.12,.03,.05)*exp(-r*1.2)*.5;}
vec3 scene(float s,vec2 p,float t){if(s<.5)return s0(p,t);if(s<1.5)return s1(p,t);if(s<2.5)return s2(p,t);if(s<3.5)return s3(p,t);return s4(p,t);}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);
  p/=1.+.06*sin(T*.21)+bass*.1;p=rot(T*.015)*p;
  vec3 c=scene(sa,p,T);if(mixv>.001)c=mix(c,scene(sb,p,T),mixv);
  c=1.-exp(-c*(1.2+hi*.35));float l=dot(c,vec3(.3,.59,.11));c=max(mix(vec3(l),c,sat),0.);c*=c*.35+.65;c*=(1.-smoothstep(.25,1.5,length(p)));
  gl_FragColor=vec4(pow(c,vec3(.95))*fade*bright,1.);
}`;
