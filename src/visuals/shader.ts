// The visuals' fragment shader: the original prototype's four scenes, ten more,
// and a near-static Ember scene for eyes-closed sessions. One shader, scene chosen
// by uniform; scenes cross-fade by mixing two scene evaluations.

export const SCENES = [
  'Chrysanthemum', 'The Tunnel', 'Liquid Jewel', 'Infinite Lattice',
  'Aurora', 'Mandala', 'Yantra', 'Moiré', 'Truchet',
  'Apollonian', 'Liquid Metal', 'Metatron', 'Harmonograph', 'Poincaré',
  'Ember',
] as const;
export const EMBER = SCENES.length - 1;

/** Cosine palettes (a + b·cos(2π(c·t + d))). The first is the prototype's own mix. */
export const PALETTES: Array<{ name: string; abcd: number[] | null }> = [
  { name: 'Twilight', abcd: null },
  { name: 'Hearth', abcd: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 0, 0.1, 0.2] },
  { name: 'Sea glass', abcd: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 0.3, 0.2, 0.2] },
  { name: 'Moss', abcd: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 0.5, 0.8, 0.9, 0.3] },
  { name: 'Dusk', abcd: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.7, 0.4, 0, 0.15, 0.2] },
  { name: 'Moonlight', abcd: [0.45, 0.46, 0.52, 0.33, 0.34, 0.38, 1, 1, 1, 0, 0.02, 0.06] },
];

export const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

export const FRAG = `precision highp float;
uniform vec2 R;uniform float T,mixv,sa,sb,bass,hi,fade,bright,sat,pacer,pacerPhase,palMix,palOrig0,palOrig1,ratioA,ratioB;uniform vec3 pa0,pb0,pc0,pd0,pa1,pb1,pc1,pd1;
#define TAU 6.2831853
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 palOrig(float t){vec3 a=.5+.5*cos(TAU*(t+vec3(0.,.33,.67)));vec3 b=.5+.5*cos(TAU*(t+vec3(0.,.15,.3)+.55));return mix(a,b,.5+.5*sin(T*.017));}
vec3 palOne(float t,vec3 a,vec3 b,vec3 c,vec3 d,float o){if(o>.5)return palOrig(t);return clamp(a+b*cos(TAU*(c*t+d)),0.,1.);}
// Palette changes cross-fade (palMix) so color never jumps.
vec3 pal(float t){vec3 x=palOne(t,pa0,pb0,pc0,pd0,palOrig0);if(palMix<.001)return x;return mix(x,palOne(t,pa1,pb1,pc1,pd1,palOrig1),palMix);}
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
  // Eight cells around: wrap the index so a cell crossing the angle seam hashes the same on both sides.
  vec2 g=fract(u)-.5,id=floor(u);id.x=mod(id.x,8.);float h=h21(id+.5);
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
// Aurora: curtains of light rising from a slow, wavy lower edge.
vec3 s4(vec2 p,float t){
  vec3 col=vec3(0);
  for(int i=0;i<3;i++){
    float fi=float(i);
    float x=p.x*(1.2+fi*.35)+t*.03*(1.+fi*.4)+fi*3.1;
    float wave=fbm(vec2(x*1.3,t*.05+fi))*1.2-.4;
    float y=p.y-(.06*fi-.3)-wave*.3;
    float rays=pow(fbm(vec2(x*9.,t*.08+fi*2.)),1.4)*1.7;
    float curtain=exp(-max(y,0.)*3.2)*smoothstep(-.04,.08,y)*rays;
    col+=pal(.35+fi*.12+wave*.1+t*.01)*curtain*.6;
  }
  return col+vec3(.01,.015,.035)*(1.-p.y);}
// Mandala: twelve-fold petals on breathing rings.
vec3 s5(vec2 p,float t){
  vec2 q=kal(rot(t*.02)*p,12.);
  float r=length(p),br=.5+.5*sin(t*.12);vec3 col=vec3(0);
  for(int i=0;i<4;i++){
    float fi=float(i);float R=.12+fi*.13+.015*br;
    vec2 d=(q-vec2(R,0.))*vec2(1.,2.2+fi*.4);
    float e=abs(length(d)-.06-.01*fi)-.004;
    col+=pal(fi*.17+t*.015)*exp(-max(e,0.)*90.)*.6*(1.-fi*.15);
    float ring=abs(r-R-.07)-.002;
    col+=pal(fi*.17+.4)*exp(-max(ring,0.)*160.)*.25;
  }
  return col+pal(t*.02)*exp(-r*14.)*.4;}
float sdTri(vec2 p,float r){const float k=1.7320508;p.x=abs(p.x)-r;p.y=p.y+r/k;if(p.x+k*p.y>0.)p=vec2(p.x-k*p.y,-k*p.x-p.y)/2.;p.x-=clamp(p.x,-2.*r,0.);return -length(p)*sign(p.y);}
// Yantra: interlocking triangles inside rings, turning very slowly.
vec3 s6(vec2 p,float t){
  vec3 col=vec3(0);float br=.5+.5*sin(t*.1);
  for(int i=0;i<5;i++){
    float fi=float(i);float up=mod(fi,2.)<.5?1.:-1.;
    vec2 q=rot(t*.01*up)*p;q.y*=up;
    float d=abs(sdTri(q,.12+fi*.075+.01*br))-.0025;
    col+=pal(.1+fi*.11+t*.01)*exp(-max(d,0.)*140.)*.55;
  }
  float r=length(p);
  for(int i=0;i<2;i++){float d=abs(r-.52-float(i)*.06)-.002;col+=pal(.6)*exp(-max(d,0.)*150.)*.25;}
  return col+pal(t*.02+.3)*exp(-r*30.)*.6;}
// Moiré: two sets of rings whose centers drift apart and back.
vec3 s7(vec2 p,float t){
  vec2 c=vec2(.18*sin(t*.023),.12*cos(t*.017));
  float a=.5+.5*cos(length(p-c)*34.),b=.5+.5*cos(length(p+c)*34.);
  float r=length(p);
  return pal(.55+r*.3+t*.01)*pow(a*b,3.)*.5*smoothstep(1.1,.2,r);}
// Truchet: a quiet field of quarter-circle arcs, slowly drifting.
vec3 s8(vec2 p,float t){
  p=rot(.3)*p*4.+vec2(t*.05,t*.03);
  vec2 id=floor(p),g=fract(p)-.5;
  if(h21(id)>.5)g.x=-g.x;
  float d=min(abs(length(g-.5)-.5),abs(length(g+.5)-.5))-.025;
  return pal(h21(id)*.25+t*.01+p.y*.02)*exp(-max(d,0.)*55.)*.5;}
// Apollonian: circles packed inside circles, found by repeated inversion.
vec3 s9(vec2 p,float t){
  p=rot(t*.01)*p*1.15;float sc=1.;vec3 col=vec3(0);
  float k=1.15+.08*sin(t*.05);
  for(int i=0;i<7;i++){
    p=-1.+2.*fract(.5*p+.5);
    float r2=dot(p,p);float f=k/max(r2,.02);p*=f;sc*=f;
    col+=pal(float(i)*.11+t*.01)*.06/(1.+r2*6.);
  }
  float d=.25*abs(p.y)/sc;
  return col*.6+pal(t*.015+.4)*exp(-d*900.)*.5;}
// Liquid Metal: slow folds catching light like polished chrome.
vec3 s10(vec2 p,float t){
  p*=1.6;float e=.01;
  float h0=fbm(p+vec2(t*.03,-t*.02)+fbm(p*1.3-t*.02));
  float hx=fbm(p+vec2(e,0.)+vec2(t*.03,-t*.02)+fbm((p+vec2(e,0.))*1.3-t*.02));
  float hy=fbm(p+vec2(0.,e)+vec2(t*.03,-t*.02)+fbm((p+vec2(0.,e))*1.3-t*.02));
  vec3 n=normalize(vec3((h0-hx)/e,(h0-hy)/e,1.2));
  vec3 l=normalize(vec3(.4,.6,.7));
  float diff=max(dot(n,l),0.),spec=pow(max(dot(reflect(-l,n),vec3(0.,0.,1.)),0.),18.);
  return pal(h0*.8+t*.01)*diff*.35+vec3(.9,.85,.95)*spec*.35;}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
// Metatron: thirteen circles and the lines between their centers, breathing.
vec3 s11(vec2 p,float t){
  float br=1.+.03*sin(t*.11);p=rot(t*.008)*p/br;
  vec3 col=vec3(0);float r=.11;
  vec2 c[13];c[0]=vec2(0.);
  for(int i=0;i<6;i++){float a=float(i)*1.0471976+.5236;c[1+i]=vec2(cos(a),sin(a))*2.*r;c[7+i]=vec2(cos(a),sin(a))*4.*r;}
  float dc=10.,dl=10.;
  for(int i=0;i<13;i++)dc=min(dc,abs(length(p-c[i])-r));
  for(int i=0;i<13;i++)for(int j=0;j<13;j++){if(j<=i)continue;dl=min(dl,seg(p,c[i],c[j]));}
  col+=pal(.15+t*.01)*exp(-dc*260.)*.55;
  col+=pal(.55+t*.01)*exp(-dl*420.)*.28;
  return col+pal(t*.02)*exp(-length(p)*18.)*.2;}
// Harmonograph: a slowly decaying Lissajous figure whose ratio follows the drone's chord.
vec3 s12(vec2 p,float t){
  float a=ratioA,b=ratioB,ph=t*.07;float d=10.;vec2 prev;
  for(int i=0;i<160;i++){
    float u=float(i)/159.*6.2831853*2.;
    float damp=1.-float(i)/220.;
    vec2 q=vec2(sin(a*u+ph),sin(b*u))*.42*damp;
    if(i>0)d=min(d,seg(p,prev,q));
    prev=q;
  }
  return pal(.3+t*.01+length(p)*.4)*exp(-d*170.)*.6;}
// Poincaré: a hyperbolic tiling of the disk, turning very slowly.
vec3 s13(vec2 p,float t){
  p=rot(t*.01)*p*1.15;float r=length(p);if(r>=1.)return vec3(0.);
  const float N=7.;const float a=3.14159265/N;const float b=3.14159265/3.;
  float cr=sqrt(1./(cos(a)*cos(a)/(sin(b)*sin(b))-1.));
  float cd=sqrt(1.+cr*cr);vec2 cc=vec2(cd,0.);
  float flips=0.;
  for(int i=0;i<24;i++){
    float ang=atan(p.y,p.x);ang=mod(ang+a,2.*a)-a;
    if(ang<0.){ang=-ang;flips+=1.;}
    p=vec2(cos(ang),sin(ang))*length(p);
    vec2 v=p-cc;float l2=dot(v,v);
    if(l2<cr*cr){p=cc+v*(cr*cr/l2);flips+=1.;}else break;
  }
  float edge=min(abs(length(p-cc)-cr),abs(atan(p.y,p.x)-a)*length(p));
  vec3 col=pal(mod(flips,2.)*.25+.2+t*.01)*(.12+.1*mod(flips,2.));
  col+=pal(.6+t*.01)*exp(-edge*90.)*.5;
  return col*smoothstep(1.,.92,r);}
// Ember: a dim, warm glow that breathes once every twenty seconds. For eyes-closed sits.
vec3 s14(vec2 p,float t){
  float r=length(p*vec2(1.,1.15));
  float br=.5+.5*sin(t*.31);
  vec3 warm=vec3(.9,.38,.14);
  float core=exp(-r*r*(5.-1.2*br));
  float haze=fbm(p*1.3+vec2(t*.01,-t*.013))*.35;
  return warm*(core*.42+haze*core*.6)+vec3(.12,.03,.05)*exp(-r*1.2)*.5;}
vec3 scene(float s,vec2 p,float t){if(s<.5)return s0(p,t);if(s<1.5)return s1(p,t);if(s<2.5)return s2(p,t);if(s<3.5)return s3(p,t);if(s<4.5)return s4(p,t);if(s<5.5)return s5(p,t);if(s<6.5)return s6(p,t);if(s<7.5)return s7(p,t);if(s<8.5)return s8(p,t);if(s<9.5)return s9(p,t);if(s<10.5)return s10(p,t);if(s<11.5)return s11(p,t);if(s<12.5)return s12(p,t);if(s<13.5)return s13(p,t);return s14(p,t);}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);
  p/=1.+.06*sin(T*.21)+bass*.1;p=rot(T*.015)*p;
  vec3 c=scene(sa,p,T);if(mixv>.001)c=mix(c,scene(sb,p,T),mixv);
  c=1.-exp(-c*(1.2+hi*.35));float l=dot(c,vec3(.3,.59,.11));c=max(mix(vec3(l),c,sat),0.);c*=c*.35+.65;c*=(1.-smoothstep(.25,1.5,length(p)));
  // Breath pacer: a soft ring that grows on the in-breath and shrinks on the out-breath.
  if(pacer>.001){float b=.5-.5*cos(6.2831853*pacerPhase);float pr=.16+.14*b;float d=abs(length((gl_FragCoord.xy-.5*R)/min(R.x,R.y))-pr);
    c+=vec3(.95,.82,.62)*exp(-d*55.)*.28*pacer;}
  gl_FragColor=vec4(pow(c,vec3(.95))*fade*bright,1.);
}`;
