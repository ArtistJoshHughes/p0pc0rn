// pocketflux-engine.js - p0pc0rn on-device engine: core 0.3.4 (FLUX.2 [klein] 4B pictures, SANA-Video 2.0 5B video; unchanged) +
// the picture-to-video / first+last-frame module i2v 0.2.0 (LTX-2.3 still encoder, frame-conditioned DiT), WebGPU, pure JS + WGSL;
// built by p0pc0rn_v018/build_engine.py from the engine/ ES modules.  Licences: NOTICE.md.  API: ENGINE_API.md.  Needs opfs_worker.js next to this file.
const __M = {};
// ---- vendor/tokenizers.min.mjs (vendored @huggingface/tokenizers 0.2.0, Apache-2.0, see LICENSE-tokenizers.txt)
__M["vendor/tokenizers.min.mjs"] = (() => {
var H=class{constructor(e){this.trie=this._build_trie(e)}_build_trie(e){let t=Object.create(null);for(let n of e){let o=t;for(let s=0;s<n.length;++s){let a=n[s];o=o[a]??=Object.create(null)}o.end=n}return t}split(e){let t=[],n=e.length,o=0,s=0;for(;s<n;){let a=this.trie,i=null,c=s;for(;c<n&&(a=a[e[c]]);)a.end&&(i=a.end),++c;i?(s>o&&t.push(e.slice(o,s)),t.push(i),s+=i.length,o=s):++s}return o<n&&t.push(e.slice(o)),t}},G=H;var Y=class{constructor(e){this.content=e.content,this.id=e.id,this.single_word=e.single_word??!1,this.lstrip=e.lstrip??!1,this.rstrip=e.rstrip??!1,this.special=e.special??!1,this.normalized=e.normalized??!this.special}},Z=Y;var jt=(r,e)=>{try{return new RegExp(r,e)}catch(t){if(!(t instanceof SyntaxError))throw t;let n=new Map,o=r.replace(/(\\[pP])\{([^}=]+)\}/g,(s,a,i,c)=>{let l=0;for(let d=c-1;d>=0&&r[d]==="\\";--d)++l;if(l%2===1)return s;let p=n.get(i);if(p===void 0){try{new RegExp(`\\p{${i}}`,"u"),p=i}catch{p=`Script=${i}`}n.set(i,p)}return`${a}{${p}}`});if(o===r)throw t;try{return new RegExp(o,e)}catch{throw t}}},D=r=>r.replace(/ \./g,".").replace(/ \?/g,"?").replace(/ \!/g,"!").replace(/ ,/g,",").replace(/ \' /g,"'").replace(/ n't/g,"n't").replace(/ 'm/g,"'m").replace(/ 's/g,"'s").replace(/ 've/g,"'ve").replace(/ 're/g,"'re"),N=(r,e=!0)=>{if(r.Regex!==void 0){let t=Sr(Nr(r.Regex));return jt(t,"gu")}else if(r.String!==void 0){let t=Dr(r.String);return new RegExp(e?t:`(${t})`,"gu")}else return console.warn("Unknown pattern type:",r),null},S="\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}",qt=`${S}\\u00B2\\u00B3\\u00B9\\u00BC-\\u00BE`,w=`[${qt}]`,Kt=`[^${qt}]`,hr=`(?:(?<!${w})(?=${w})|(?<=${w})(?!${w}))`,mr=`(?:(?<!${w})(?!${w})|(?<=${w})(?=${w}))`,gr="(?:(?<![\\s\\S])|(?<=\\n))",kr="(?:(?=\\n)|(?![\\s\\S]))",$="0-9A-Fa-f",zr=new Map([["A","(?<![\\s\\S])"],["z","(?![\\s\\S])"],["Z","(?=\\n?(?![\\s\\S]))"],["h",`[${$}]`],["H",`[^${$}]`],["w",w],["W",Kt],["d","\\p{Nd}"],["D","\\P{Nd}"],["s","\\p{White_Space}"],["S","\\P{White_Space}"],["b",hr],["B",mr],["a","\\x07"],["e","\\x1B"]]),br=new Map([["h",$],["w",S],["d","\\p{Nd}"],["D","\\P{Nd}"],["s","\\p{White_Space}"],["S","\\P{White_Space}"],["a","\\x07"],["e","\\x1B"]]),xr=new Map([["W",`[^${S}]`],["H",`[^${$}]`]]),Xt=new Map([[`
`,"\\n"],["\r","\\r"],["	","\\t"],["\f","\\f"],["\v","\\v"]]),Tr=new Map([["alpha","\\p{Alphabetic}"],["alnum","\\p{Alphabetic}\\p{Nd}"],["digit","\\p{Nd}"],["lower","\\p{Lowercase}"],["upper","\\p{Uppercase}"],["space","\\p{White_Space}"],["blank","\\t\\p{Zs}"],["punct","\\p{P}\\p{S}"],["cntrl","\\p{Cc}"],["word",S],["xdigit",$]]),Ht="^$\\.*+?()[]{}|/",yr=/^\(\?(?:<[=!]|<[A-Za-z_][A-Za-z0-9_]*>|[:=!>])/,Gt=/^\\([pPxu])\{([^}]*)\}/,wr=/^\{(\d+(?:,\d*)?|,\d+)\}/,Pr=/^\[:(\^?)(\p{Alphabetic}+):\]/u,Cr=/^\[:\^:\]/,vr=/^\[(?:\.[^\]]*\.\]|=[^\]]*=\])/,Yt=/^(?:\\x[0-9A-Fa-f]{2}|\\u[0-9A-Fa-f]{4}|\\c[A-Za-z])/,Zt=r=>r>="A"&&r<="Z"||r>="a"&&r<="z",B=(r,e)=>String.fromCodePoint(r.codePointAt(e)),Lt=r=>{if(!/^[0-9A-Fa-f]{1,8}$/.test(r))return null;let e=Number.parseInt(r,16);if(e>127)return null;let t=String.fromCharCode(e);return Zt(t)?`[${t.toLowerCase()}${t.toUpperCase()}]`:null},Nr=r=>r.replace(/\[\^\(\\s\|\[([^\]]+)\]\)\]/g,"[^()|\\s$1]"),Jt="[\\s\\S]",Ut=256,Wt=()=>({fragment:"",alternatives:[],tail:null,contains_complex_set:!1}),J=r=>{throw new SyntaxError(`Unsupported range with a set-valued character-class operand at index ${r}`)},F=(r,e,t,n=!0)=>{r.tail==="range"&&J(t),r.alternatives.push(e),r.tail="set",r.contains_complex_set=r.contains_complex_set||n},v=(r,e,t=!1,n=-1)=>{if(t&&r.tail==="range"&&J(n),r.tail==="range"){r.fragment+=e,r.tail="complete_range";return}r.fragment+=e,r.tail=t?"set":"scalar",r.contains_complex_set=r.contains_complex_set||t},Er=(r,e,t)=>{let n=Gt.exec(r.slice(e));if(n){let[z,g,u]=n;if(g==="P"&&u==="Word")F(t,`[^${S}]`,e);else{let m=g==="x"?`\\u{${u}}`:g==="p"&&u==="Word"?S:z;v(t,m,g==="p"||g==="P",e)}return e+z.length}let o=Yt.exec(r.slice(e));if(o)return v(t,o[0]),e+o[0].length;if(e+1>=r.length)throw new SyntaxError(`Unterminated escape in character class at index ${e}`);let s=B(r,e+1),a=e+1+s.length,i=Xt.get(s);if(i!==void 0)return v(t,i),a;let c=xr.get(s);if(c!==void 0)return F(t,c,e),a;let l=br.get(s),p,d=!1;return l!==void 0?(p=l,d=s!=="a"&&s!=="e"):/[A-Za-z0-9]/.test(s)?p=`\\${s}`:Ht.includes(s)||s==="-"?p=`\\${s}`:p=s,v(t,p,d,e),a},Vt=r=>r.length===1?r[0]:`(?:(?=(?:${r.join("|")}))${Jt})`,It=r=>{let e=r.fragment.length===0?r.alternatives:[`[${r.fragment}]`,...r.alternatives];return Vt(e)},Ar=r=>{let e=jt(`^(?:${r})$`,"u"),t="";for(let n=0;n<26;++n){let o=String.fromCharCode(65+n),s=String.fromCharCode(97+n),a=e.test(o),i=e.test(s);a!==i&&(t+=a?s:o)}return t},Qt=(r,e,t,n=!0,o=1)=>{if(o>Ut)throw new SyntaxError(`Maximum character-class nesting depth of ${Ut} exceeded at index ${e}`);let s=e+1,a=r[s]==="^";a&&++s;let i=s,c=[Wt()],l=c[0],p=!1;for(;s<r.length;){let d=B(r,s);if(d==="\\"){s=Er(r,s,l);continue}if(d==="]"){if(s===i){v(l,"\\]"),++s;continue}if(l.tail===null)throw c.length>1?new SyntaxError(`Malformed character-class intersection with an empty operand at index ${s}`):new SyntaxError(`Empty character class at index ${e}`);let z=c.some(x=>x.contains_complex_set);if(a&&c.length>1&&p)throw new SyntaxError(`Unsupported outer-negated character-class intersection with a nested negated class containing a Unicode property, POSIX class, or shorthand at index ${e}`);let g=It(c[0]),u=g;if(c.length>1){let x="";for(let A=1;A<c.length;++A)x+=`(?=${It(c[A])})`;u=`(?:${x}${g})`}let m=c.length===1&&l.alternatives.length===0,b=l.fragment;if(t&&n){let x=Ar(u);x.length>0&&(m?(b+=x,u=`[${b}]`):u=Vt([u,`[${x}]`]))}return{atom:a?m?`[^${b}]`:`(?:(?!${u})${Jt})`:u,end:s+1,negated:a,contains_complex_set:z,contains_nested_negated_complex_set:p}}if(r.startsWith("&&",s)){if(l.tail===null)throw new SyntaxError(`Malformed character-class intersection with an empty operand at index ${s}`);l=Wt(),c.push(l),s+=2;continue}if(d==="["){let z=r.slice(s);if(Cr.test(z))throw new SyntaxError(`Malformed empty negated POSIX character class at index ${s}`);let g=Pr.exec(z);if(g){let[,m,b]=g,C=Tr.get(b);if(C===void 0)throw new SyntaxError(`Unsupported POSIX character class "${b}" at index ${s}`);if(t&&m&&(b==="lower"||b==="upper"))throw new SyntaxError(`Unsupported negated POSIX ${b} class inside an inline case-insensitive group`);m?F(l,`[^${C}]`,s):v(l,C,!0,s),s+=g[0].length;continue}if(vr.test(z))throw new SyntaxError(`Unsupported POSIX collating or equivalence bracket expression at index ${s}`);let u=Qt(r,s,t,!1,o+1);F(l,u.atom,s,u.contains_complex_set),p||=u.contains_nested_negated_complex_set||u.negated&&u.contains_complex_set,s=u.end;continue}if(d==="-"){let z=r[s+1]==="]"||r.startsWith("&&",s+1);l.tail==="set"&&!z&&J(s),l.tail===null||l.tail==="range"||l.tail==="complete_range"||z?v(l,"\\-"):(l.fragment+="-",l.tail="range"),++s;continue}v(l,d==="^"&&l.fragment.length===0?"\\^":d),s+=d.length}throw new SyntaxError(`${c.length>1?"Unterminated character-class intersection":"Unterminated character class"} at index ${e}`)},Sr=r=>{let e="",t=-1,n=!1,o=!1,s=[],a=i=>{t=e.length,e+=i,n=!1};for(let i=0;i<r.length;){let c=B(r,i);if(c==="\\"){let l=Gt.exec(r.slice(i));if(l){let[m,b,C]=l,x=m;if(b==="x"){let A=`\\u{${C}}`;x=o?Lt(C)??A:A}else C==="Word"&&(x=b==="p"?w:Kt);a(x),i+=m.length;continue}let p=Yt.exec(r.slice(i));if(p){let m=p[0],b=o&&m[1]!=="c"?Lt(m.slice(2))??m:m;a(b),i+=m.length;continue}if(i+1>=r.length){e+=c;break}let d=B(r,i+1);if(i+=1+d.length,d==="G")continue;let z=Xt.get(d);if(z!==void 0){a(z);continue}let g=zr.get(d),u;g!==void 0?u=g:/[A-Za-z0-9]/.test(d)?u=`\\${d}`:Ht.includes(d)?u=`\\${d}`:u=d,a(u);continue}switch(c){case"[":{let l=Qt(r,i,o);a(l.atom),i=l.end;continue}case"]":a("\\]"),++i;continue;case".":a("[^\\n]"),++i;continue;case"^":a(gr),++i;continue;case"$":a(kr),++i;continue;case"(":{let l=r.startsWith("(?i:",i),p=l?"(?i:":yr.exec(r.slice(i))?.[0]??"(",d=l||p==="(?>"?"(?:":p;s.push([e.length,o]),l&&(o=!0),e+=d,n=!1,i+=p.length;continue}case")":e+=c,[t,o]=s.pop()??[-1,!1],n=!1,++i;continue;case"|":e+=c,t=-1,n=!1,++i;continue;case"{":{let l=wr.exec(r.slice(i));if(!l||t<0){a("\\{"),++i;continue}let p=l[1].startsWith(",")?`0${l[1]}`:l[1];i+=l[0].length;let d=r[i];d==="+"||d==="*"?(e=`${e.slice(0,t)}(?:${e.slice(t)}{${p}})${d}`,++i):e+=`{${p}}`,n=!0;continue}case"}":a("\\}"),++i;continue;case"+":if(n){++i;continue}e+=c,n=!0,++i;continue;case"*":case"?":e+=c,n=!0,++i;continue;default:a(o&&Zt(c)?`[${c.toLowerCase()}${c.toUpperCase()}]`:c),i+=c.length;continue}}return e},Dr=r=>r.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),er=(r,e,t)=>{let n=[],o=0;for(;o<r.length;){if(n.push(r[o]),(e.get(r[o])??t)!==t){++o;continue}for(;++o<r.length&&(e.get(r[o])??t)===t;)e.get(n.at(-1))!==t&&(n[n.length-1]+=r[o])}return n},tr=r=>r>=19968&&r<=40959||r>=13312&&r<=19903||r>=131072&&r<=173791||r>=173824&&r<=177983||r>=177984&&r<=178207||r>=178208&&r<=183983||r>=63744&&r<=64255||r>=194560&&r<=195103,rr=r=>Number.isInteger(r)||typeof r=="bigint",nr=r=>{let e=0;for(let t of r)++e;return e},or=r=>V(r.toLowerCase()),k=(...r)=>Array.prototype.concat.apply([],r),O=r=>new Map(Object.entries(r)),sr=(r,e)=>{let t=[],n=0;for(let o of r.matchAll(e)){let s=o[0];n<o.index&&t.push(r.slice(n,o.index)),s.length>0&&t.push(s),n=o.index+s.length}return n<r.length&&t.push(r.slice(n)),t},V=r=>r.replace(/\p{M}/gu,""),Q=(r,e,t=[])=>{if(!r||Array.isArray(r)||typeof r!="object")return`${e} must be a valid object`;for(let n of t)if(!(n in r))return`${e} must contain a "${n}" property`;return null},ir=r=>r.match(/\S+/g)||[];var ee=class{constructor(){let e=function(...t){return e._call(...t)};return Object.setPrototypeOf(e,new.target.prototype)}},T=ee;var te=class extends T{constructor(e){super(),this.config=e}_call(e){return this.normalize(e)}},h=te;var re=class extends h{tokenize_chinese_chars(e){let t=[];for(let n=0;n<e.length;++n){let o=e[n],s=o.charCodeAt(0);tr(s)?(t.push(" "),t.push(o),t.push(" ")):t.push(o)}return t.join("")}strip_accents(e){return e.normalize("NFD").replace(/\p{Mn}/gu,"")}is_control(e){switch(e){case"	":case`
`:case"\r":return!1;default:return/^\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}$/u.test(e)}}clean_text(e){let t=[];for(let n of e){let o=n.charCodeAt(0);o===0||o===65533||this.is_control(n)||(/^\s$/.test(n)?t.push(" "):t.push(n))}return t.join("")}normalize(e){return this.config.clean_text&&(e=this.clean_text(e)),this.config.handle_chinese_chars&&(e=this.tokenize_chinese_chars(e)),this.config.lowercase?(e=e.toLowerCase(),this.config.strip_accents!==!1&&(e=this.strip_accents(e))):this.config.strip_accents&&(e=this.strip_accents(e)),e}},ne=re;var oe=class extends h{constructor(e){super(e),this.charsmap=e.precompiled_charsmap??null}normalize(e){return e=e.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm,""),e=e.replace(/[\u0009\u000A\u000C\u000D\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u2581\u3000\uFEFF\uFFFD]/gm," "),e.includes("\uFF5E")?e=e.split("\uFF5E").map(n=>n.normalize("NFKC")).join("\uFF5E"):e=e.normalize("NFKC"),e}},se=oe;var ie=class extends h{constructor(e){super(e),this.normalizers=(e.normalizers??[]).map(t=>L(t))}normalize(e){return this.normalizers.reduce((t,n)=>n?n.normalize(t):t,e)}},ae=ie;var ce=class extends h{constructor(e){super(e),this.pattern=N(this.config.pattern??{})}normalize(e){return this.pattern===null?e:e.replaceAll(this.pattern,this.config.content??"")}},le=ce;var pe=class extends h{constructor(){super(...arguments);this.form="NFC"}normalize(t){return t=t.normalize(this.form),t}},E=pe;var de=class extends E{constructor(){super(...arguments);this.form="NFC"}},ue=de;var fe=class extends E{constructor(){super(...arguments);this.form="NFD"}},_e=fe;var he=class extends E{constructor(){super(...arguments);this.form="NFKC"}},me=he;var ge=class extends E{constructor(){super(...arguments);this.form="NFKD"}},ke=ge;var ze=class extends h{normalize(e){return this.config.strip_left&&this.config.strip_right?e=e.trim():(this.config.strip_left&&(e=e.trimStart()),this.config.strip_right&&(e=e.trimEnd())),e}},be=ze;var xe=class extends h{normalize(e){return V(e)}},Te=xe;var ye=class extends h{normalize(e){return e.toLowerCase()}},we=ye;var Pe=class extends h{normalize(e){return e=this.config.prepend+e,e}},Ce=Pe;function Or(r){if(r===null)return null;switch(r.type){case"BertNormalizer":return new ne(r);case"Precompiled":return new se(r);case"Sequence":return new ae(r);case"Replace":return new le(r);case"NFC":return new ue(r);case"NFD":return new _e(r);case"NFKC":return new me(r);case"NFKD":return new ke(r);case"Strip":return new be(r);case"StripAccents":return new Te(r);case"Lowercase":return new we(r);case"Prepend":return new Ce(r);default:throw new Error(`Unknown Normalizer type: ${r.type}`)}}var L=Or;var ve=class extends T{pre_tokenize(e,t){return(Array.isArray(e)?e.map(n=>this.pre_tokenize_text(n,t)):this.pre_tokenize_text(e,t)).flat()}_call(e,t){return this.pre_tokenize(e,t)}},f=ve;var Ne=(()=>{let r=[...Array.from({length:94},(o,s)=>s+33),...Array.from({length:12},(o,s)=>s+161),...Array.from({length:82},(o,s)=>s+174)],e=r.slice(),t=0;for(let o=0;o<256;++o)r.includes(o)||(r.push(o),e.push(256+t),t+=1);let n=e.map(o=>String.fromCharCode(o));return Object.fromEntries(r.map((o,s)=>[o,n[s]]))})(),Rr=r=>Object.fromEntries(Object.entries(r).map(([e,t])=>[t,e])),ar=Rr(Ne),R="\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E";var Ee=class extends f{constructor(e){super(),this.config=e,this.add_prefix_space=this.config.add_prefix_space??!1,this.trim_offsets=this.config.trim_offsets??!1,this.use_regex=this.config.use_regex??!0,this.pattern=/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,this.byte_encoder=Ne,this.text_encoder=new TextEncoder}pre_tokenize_text(e,t){return this.add_prefix_space&&!e.startsWith(" ")&&(e=" "+e),(this.use_regex?e.match(this.pattern)||[]:[e]).map(o=>Array.from(this.text_encoder.encode(o),s=>this.byte_encoder[s]).join(""))}},Ae=Ee;var Se=class extends f{pre_tokenize_text(e,t){return e.match(/\w+|[^\w\s]+/g)||[]}},De=Se;var Oe=class extends f{constructor(e){super(),this.replacement=e.replacement??"\u2581",this.str_rep=e.str_rep||this.replacement,this.prepend_scheme=e.prepend_scheme??"always"}pre_tokenize_text(e,t){let{section_index:n=void 0}=t??{},o=e.replaceAll(" ",this.str_rep);return!o.startsWith(this.replacement)&&(this.prepend_scheme==="always"||this.prepend_scheme==="first"&&n===0)&&(o=this.str_rep+o),[o]}},Re=Oe;var $e=class extends f{constructor(e){super(),this.config=e,this.pattern=N(this.config.pattern??{},this.config.invert??!0)}pre_tokenize_text(e){return this.pattern===null?[]:this.config.invert?(e.match(this.pattern)||[]).filter(t=>t):this.config.behavior?.toLowerCase()==="removed"?e.split(this.pattern).filter(t=>t):sr(e,this.pattern)}},Me=$e;var Be=class extends f{constructor(e){super(),this.config=e,this.pattern=new RegExp(`[^${R}]+|[${R}]+`,"gu")}pre_tokenize_text(e){return e.match(this.pattern)||[]}},Fe=Be;var Le=class extends f{constructor(e){super(),this.config=e;let t=`[^\\d]+|\\d${this.config.individual_digits?"":"+"}`;this.pattern=new RegExp(t,"gu")}pre_tokenize_text(e){return e.match(this.pattern)||[]}},Ue=Le;var We=class extends f{constructor(){super(),this.pattern=new RegExp(`[^\\s${R}]+|[${R}]`,"gu")}pre_tokenize_text(e,t){return e.trim().match(this.pattern)||[]}},Ie=We;var je=class extends f{constructor(e){super(),this.config=e,this.pattern=N(this.config.pattern??{}),this.content=this.config.content??""}pre_tokenize_text(e){return this.pattern===null?[e]:[e.replaceAll(this.pattern,this.config.content??"")]}},qe=je;var Ke=class extends f{constructor(e){super(),this.tokenizers=(e.pretokenizers??[]).map(t=>U(t))}pre_tokenize_text(e,t){return this.tokenizers.reduce((n,o)=>o?o.pre_tokenize(n,t):n,[e])}},Xe=Ke;var He=class extends f{pre_tokenize_text(e){return ir(e)}},Ge=He;var Ye=class extends f{constructor(e){super(),this.config=e,this._length=e.length}pre_tokenize_text(e){let t=[];for(let n=0;n<e.length;n+=this._length)t.push(e.slice(n,n+this._length));return t}},Ze=Ye;function $r(r){if(r===null)return null;switch(r.type){case"BertPreTokenizer":return new Ie;case"Sequence":return new Xe(r);case"Whitespace":return new De;case"WhitespaceSplit":return new Ge;case"Metaspace":return new Re(r);case"ByteLevel":return new Ae(r);case"Split":return new Me(r);case"Punctuation":return new Fe(r);case"Digits":return new Ue(r);case"Replace":return new qe(r);case"FixedLength":return new Ze(r);default:throw new Error(`Unknown PreTokenizer type: ${r.type}`)}}var U=$r;var Je=class extends T{constructor(e){super(),this.config=e,this.vocab=[],this.tokens_to_ids=new Map,this.unk_token_id=void 0,this.unk_token=void 0,this.end_of_word_suffix=void 0,this.fuse_unk=this.config.fuse_unk??!1}_call(e){let t=this.encode(e);return this.fuse_unk&&(t=er(t,this.tokens_to_ids,this.unk_token_id)),t}},P=Je;var Ve=class extends P{constructor(t){super(t);this.max_input_chars_per_word=100;this.tokens_to_ids=O(t.vocab),this.unk_token_id=this.tokens_to_ids.get(t.unk_token),this.unk_token=t.unk_token,this.max_input_chars_per_word=t.max_input_chars_per_word??100,this.vocab=new Array(this.tokens_to_ids.size);for(let[n,o]of this.tokens_to_ids)this.vocab[o]=n}encode(t){let n=[];for(let o of t){let s=[...o];if(s.length>this.max_input_chars_per_word){n.push(this.unk_token);continue}let a=!1,i=0,c=[];for(;i<s.length;){let l=s.length,p=null;for(;i<l;){let d=s.slice(i,l).join("");if(i>0&&(d=this.config.continuing_subword_prefix+d),this.tokens_to_ids.has(d)){p=d;break}--l}if(p===null){a=!0;break}c.push(p),i=l}a?n.push(this.unk_token):n.push(...c)}return n}},W=Ve;var I=class r{constructor(e,t){this.is_leaf=e,this.children=t}static default(){return new r(!1,new Map)}},Qe=class{constructor(){this.root=I.default()}extend(e){for(let t of e)this.push(t)}push(e){let t=this.root;for(let n of e){let o=t.children.get(n);o===void 0&&(o=I.default(),t.children.set(n,o)),t=o}t.is_leaf=!0}*common_prefix_search(e,t=0){let n=this.root;if(n===void 0)return;let o="";for(let s=t;s<e.length;++s){let a=e[s];if(o+=a,n=n.children.get(a),n===void 0)return;n.is_leaf&&(yield o)}}},cr=Qe;var M=class r{constructor(e,t,n,o,s){this.token_id=e,this.node_id=t,this.pos=n,this.length=o,this.score=s,this.prev=null,this.backtrace_score=0}clone(){let e=new r(this.token_id,this.node_id,this.pos,this.length,this.score);return e.prev=this.prev,e.backtrace_score=this.backtrace_score,e}},et=class{constructor(e,t,n){this.chars=Array.from(e),this.len=this.chars.length,this.bos_token_id=t,this.eos_token_id=n,this.nodes=[],this.begin_nodes=Array.from({length:this.len+1},()=>[]),this.end_nodes=Array.from({length:this.len+1},()=>[]);let o=new M(this.bos_token_id??0,0,0,0,0),s=new M(this.eos_token_id??0,1,this.len,0,0);this.nodes.push(o.clone()),this.nodes.push(s.clone()),this.begin_nodes[this.len].push(s),this.end_nodes[0].push(o)}insert(e,t,n,o){let s=this.nodes.length,a=new M(o,s,e,t,n);this.begin_nodes[e].push(a),this.end_nodes[e+t].push(a),this.nodes.push(a)}viterbi(){let e=this.len,t=0;for(;t<=e;){if(this.begin_nodes[t].length==0)return[];for(let i of this.begin_nodes[t]){i.prev=null;let c=0,l=null;for(let p of this.end_nodes[t]){let d=p.backtrace_score+i.score;(l===null||d>c)&&(l=p.clone(),c=d)}if(l!==null)i.prev=l,i.backtrace_score=c;else return[]}++t}let n=[],s=this.begin_nodes[e][0].prev;if(s===null)return[];let a=s.clone();for(;a.prev!==null;)n.push(a.clone()),a=a.clone().prev.clone();return n.reverse(),n}piece(e){return this.chars.slice(e.pos,e.pos+e.length).join("")}tokens(){return this.viterbi().map(t=>this.piece(t))}token_ids(){return this.viterbi().map(t=>t.token_id)}},lr=et;function pr(r){if(r.length===0)throw new Error("Array must not be empty");let e=r[0],t=0;for(let n=1;n<r.length;++n)r[n]<e&&(e=r[n],t=n);return[e,t]}var tt=class extends P{constructor(e,t){super(e);let n=e.vocab.length;this.vocab=new Array(n),this.scores=new Array(n);for(let o=0;o<n;++o)[this.vocab[o],this.scores[o]]=e.vocab[o];this.unk_token_id=e.unk_id,this.unk_token=this.vocab[e.unk_id],this.tokens_to_ids=new Map(this.vocab.map((o,s)=>[o,s])),this.bos_token=" ",this.bos_token_id=this.tokens_to_ids.get(this.bos_token),this.eos_token=t,this.eos_token_id=this.tokens_to_ids.get(this.eos_token),this.unk_token=this.vocab[this.unk_token_id],this.min_score=pr(this.scores)[0],this.unk_score=this.min_score-10,this.scores[this.unk_token_id]=this.unk_score,this.trie=new cr,this.trie.extend(this.vocab),this.fuse_unk=!0}populate_nodes(e){let t=e.chars,n=1,o=0;for(;o<t.length;){let s=!1,a=this.trie.common_prefix_search(t,o);for(let i of a){let c=this.tokens_to_ids.get(i),l=this.scores[c],p=nr(i);e.insert(o,p,l,c),!s&&p===n&&(s=!0)}s||e.insert(o,n,this.unk_score,this.unk_token_id),o+=n}}tokenize(e){let t=new lr(e,this.bos_token_id,this.eos_token_id);return this.populate_nodes(t),t.tokens()}encode(e){let t=[];for(let n of e){let o=this.tokenize(n);t.push(...o)}return t}},j=tt;var rt=class{constructor(e=(n,o)=>n>o,t=1/0){this._heap=[],this._comparator=e,this._max_size=t}get size(){return this._heap.length}is_empty(){return this.size===0}peek(){return this._heap[0]}push(...e){return this.extend(e)}extend(e){for(let t of e)if(this.size<this._max_size)this._heap.push(t),this._sift_up();else{let n=this._smallest();this._comparator(t,this._heap[n])&&(this._heap[n]=t,this._sift_up_from(n))}return this.size}pop(){let e=this.peek(),t=this.size-1;return t>0&&this._swap(0,t),this._heap.pop(),this._sift_down(),e}replace(e){let t=this.peek();return this._heap[0]=e,this._sift_down(),t}_parent(e){return(e+1>>>1)-1}_left(e){return(e<<1)+1}_right(e){return e+1<<1}_greater(e,t){return this._comparator(this._heap[e],this._heap[t])}_swap(e,t){let n=this._heap[e];this._heap[e]=this._heap[t],this._heap[t]=n}_sift_up(){this._sift_up_from(this.size-1)}_sift_up_from(e){for(;e>0&&this._greater(e,this._parent(e));)this._swap(e,this._parent(e)),e=this._parent(e)}_sift_down(){let e=0;for(;this._left(e)<this.size&&this._greater(this._left(e),e)||this._right(e)<this.size&&this._greater(this._right(e),e);){let t=this._right(e)<this.size&&this._greater(this._right(e),this._left(e))?this._right(e):this._left(e);this._swap(e,t),e=t}}_smallest(){return 2**Math.floor(Math.log2(this.size))-1}},dr=rt;var nt=class{constructor(e){this.capacity=e,this.cache=new Map}get(e){if(!this.cache.has(e))return;let t=this.cache.get(e);return this.cache.delete(e),this.cache.set(e,t),t}put(e,t){this.cache.has(e)&&this.cache.delete(e),this.cache.set(e,t),this.cache.size>this.capacity&&this.cache.delete(this.cache.keys().next().value)}clear(){this.cache.clear()}},ur=nt;var ot=class extends P{constructor(e){super(e),this.tokens_to_ids=O(e.vocab),this.unk_token_id=this.tokens_to_ids.get(e.unk_token),this.unk_token=e.unk_token,this.vocab=new Array(this.tokens_to_ids.size);for(let[n,o]of this.tokens_to_ids)this.vocab[o]=n;let t=Array.isArray(e.merges[0]);this.merges=t?e.merges:e.merges.map(n=>n.split(" ",2)),this.bpe_ranks=new Map(this.merges.map((n,o)=>[JSON.stringify(n),o])),this.end_of_word_suffix=e.end_of_word_suffix,this.continuing_subword_suffix=e.continuing_subword_suffix??null,this.byte_fallback=this.config.byte_fallback??!1,this.byte_fallback&&(this.text_encoder=new TextEncoder),this.ignore_merges=this.config.ignore_merges??!1,this.max_length_to_cache=256,this.cache_capacity=1e4,this.cache=new ur(this.cache_capacity)}clear_cache(){this.cache.clear()}bpe(e){if(e.length===0)return[];let t=this.cache.get(e);if(t!==void 0)return t;let n=Array.from(e);this.end_of_word_suffix&&(n[n.length-1]+=this.end_of_word_suffix);let o=[];if(n.length>1){let s=new dr((c,l)=>c.score<l.score),a={token:n[0],bias:0,prev:null,next:null},i=a;for(let c=1;c<n.length;++c){let l={bias:c/n.length,token:n[c],prev:i,next:null};i.next=l,this.add_node(s,i),i=l}for(;!s.is_empty();){let c=s.pop();if(c.deleted||!c.next||c.next.deleted)continue;if(c.deleted=!0,c.next.deleted=!0,c.prev){let p={...c.prev};c.prev.deleted=!0,c.prev=p,p.prev?p.prev.next=p:a=p}let l={token:c.token+c.next.token,bias:c.bias,prev:c.prev,next:c.next.next};l.prev?(l.prev.next=l,this.add_node(s,l.prev)):a=l,l.next&&(l.next.prev=l,this.add_node(s,l))}for(let c=a;c!==null;c=c.next)o.push(c.token)}else o=n;if(this.continuing_subword_suffix)for(let s=0;s<o.length-1;++s)o[s]+=this.continuing_subword_suffix;return e.length<this.max_length_to_cache&&this.cache.put(e,o),o}add_node(e,t){let n=this.bpe_ranks.get(JSON.stringify([t.token,t.next.token]));n!==void 0&&(t.score=n+t.bias,e.push(t))}encode(e){let t=[];for(let n of e){if(this.ignore_merges&&this.tokens_to_ids.has(n)){t.push(n);continue}let o=this.bpe(n);for(let s of o)if(this.tokens_to_ids.has(s))t.push(s);else if(this.byte_fallback){let a=Array.from(this.text_encoder.encode(s)).map(i=>`<0x${i.toString(16).toUpperCase().padStart(2,"0")}>`);a.every(i=>this.tokens_to_ids.has(i))?t.push(...a):this.unk_token!=null&&t.push(this.unk_token)}else this.unk_token!=null&&t.push(this.unk_token)}return t}},q=ot;var st=class extends P{constructor(e,t){super(e);let n=e.vocab;this.tokens_to_ids=O(t.target_lang?n[t.target_lang]:n),this.bos_token=t.bos_token,this.bos_token_id=this.tokens_to_ids.get(this.bos_token),this.eos_token=t.eos_token,this.eos_token_id=this.tokens_to_ids.get(this.eos_token),this.pad_token=t.pad_token,this.pad_token_id=this.tokens_to_ids.get(this.pad_token),this.unk_token=t.unk_token,this.unk_token_id=this.tokens_to_ids.get(this.unk_token),this.vocab=new Array(this.tokens_to_ids.size);for(let[o,s]of this.tokens_to_ids)this.vocab[s]=o}encode(e){return e}},fr=st;function Mr(r,e){switch(r.type){case"WordPiece":return new W(r);case"Unigram":return new j(r,e.eos_token);case"BPE":return new q(r);default:if(r.vocab)return Array.isArray(r.vocab)?new j(r,e.eos_token):Object.hasOwn(r,"continuing_subword_prefix")&&Object.hasOwn(r,"unk_token")?Object.hasOwn(r,"merges")?new q(r):new W(r):new fr(r,{target_lang:e.target_lang,bos_token:e.bos_token,eos_token:e.eos_token,pad_token:e.pad_token,unk_token:e.unk_token});throw new Error(`Unknown TokenizerModel type: ${r?.type}`)}}var _r=Mr;var it=class extends T{constructor(e){super(),this.config=e}_call(e,...t){return this.post_process(e,...t)}},y=it;var at=class extends y{post_process(e,t=null,n=!0){let o=t===null?this.config.single:this.config.pair,s=[],a=[];for(let i of o)"SpecialToken"in i?n&&(s.push(i.SpecialToken.id),a.push(i.SpecialToken.type_id)):"Sequence"in i&&(i.Sequence.id==="A"?(s=k(s,e),a=k(a,new Array(e.length).fill(i.Sequence.type_id))):i.Sequence.id==="B"&&(s=k(s,t),a=k(a,new Array(t.length).fill(i.Sequence.type_id))));return{tokens:s,token_type_ids:a}}},ct=at;var lt=class extends y{post_process(e,t=null){return{tokens:e,tokens_pair:t}}},pt=lt;var dt=class extends y{constructor(e){super(e),this.sep=e.sep,this.cls=e.cls}post_process(e,t=null,n=!0){n&&(e=k([this.cls[0]],e,[this.sep[0]]));let o=new Array(e.length).fill(0);if(t){let s=[],a=n?[this.sep[0]]:[];e=k(e,s,t,a),o=k(o,new Array(t.length+s.length+a.length).fill(1))}return{tokens:e,token_type_ids:o}}},ut=dt;var ft=class extends y{constructor(e){super(e),this.sep=e.sep,this.cls=e.cls}post_process(e,t,n=!0){n&&(e=k([this.cls[0]],e,[this.sep[0]]));let o=new Array(e.length).fill(0);if(t){let s=n?[this.sep[0]]:[],a=n?[this.sep[0]]:[];e=k(e,s,t,a),o=k(o,new Array(t.length+s.length+a.length).fill(1))}return{tokens:e,token_type_ids:o}}},_t=ft;var ht=class extends y{constructor(e){super(e),this.processors=(e.processors??[]).map(t=>K(t))}post_process(e,t=null,n=!0){let o={tokens:e,tokens_pair:t};for(let s of this.processors)o=s.post_process(o.tokens,o.tokens_pair,n);return o}},mt=ht;function Br(r){if(r===null)return null;switch(r.type){case"TemplateProcessing":return new ct(r);case"ByteLevel":return new pt(r);case"BertProcessing":return new ut(r);case"RobertaProcessing":return new _t(r);case"Sequence":return new mt(r);default:throw new Error(`Unknown PostProcessor type: ${r.type}`)}}var K=Br;var gt=class extends T{constructor(e){super(),this.config=e,this.added_tokens=[],this.end_of_word_suffix=null,this.trim_offsets="trim_offsets"in e?e.trim_offsets:!1}_call(e){return this.decode(e)}decode(e){return this.decode_chain(e).join("")}},_=gt;var kt=class extends _{constructor(e){super(e),this.byte_decoder=ar,this.text_decoder=new TextDecoder("utf-8",{fatal:!1,ignoreBOM:!0}),this.end_of_word_suffix=null}convert_tokens_to_string(e){let t=e.join(""),n=new Uint8Array([...t].map(o=>this.byte_decoder[o]));return this.text_decoder.decode(n)}decode_chain(e){let t=[],n=[];for(let o of e)this.added_tokens.find(s=>s.content===o)!==void 0?(n.length>0&&(t.push(this.convert_tokens_to_string(n)),n=[]),t.push(o)):n.push(o);return n.length>0&&t.push(this.convert_tokens_to_string(n)),t}},zt=kt;var bt=class extends _{constructor(e){super(e),this.cleanup=e.cleanup}decode_chain(e){return e.map((t,n)=>{if(n!==0){let o=this.config.prefix;o&&t.startsWith(o)?t=t.replace(o,""):t=" "+t}return this.cleanup&&(t=D(t)),t})}},xt=bt;var Tt=class extends _{constructor(e){super(e),this.replacement=e.replacement??"\u2581"}decode_chain(e){let t=[];for(let n=0;n<e.length;++n){let o=e[n].replaceAll(this.replacement," ");n==0&&o.startsWith(" ")&&(o=o.substring(1)),t.push(o)}return t}},yt=Tt;var wt=class extends _{constructor(e){super(e),this.suffix=e.suffix??""}decode_chain(e){return e.map((t,n)=>t.replaceAll(this.suffix,n===e.length-1?"":" "))}},Pt=wt;var Ct=class extends _{constructor(e){super(e),this.pad_token=e.pad_token??"",this.word_delimiter_token=e.word_delimiter_token??"",this.cleanup=e.cleanup}convert_tokens_to_string(e){if(e.length===0)return"";let t=[e[0]];for(let s=1;s<e.length;++s)e[s]!==t.at(-1)&&t.push(e[s]);let o=t.filter(s=>s!==this.pad_token).join("");return this.cleanup&&(o=D(o).replaceAll(this.word_delimiter_token," ").trim()),o}decode_chain(e){return[this.convert_tokens_to_string(e)]}},vt=Ct;var Nt=class extends _{constructor(e){super(e),this.decoders=(e.decoders??[]).map(t=>X(t))}decode_chain(e){return this.decoders.reduce((t,n)=>n.decode_chain(t),e)}},Et=Nt;var At=class extends _{constructor(e){super(e),this.pattern=N(this.config.pattern)}decode_chain(e){let t=this.config.content??"",n=this.pattern;return n===null?e:e.map(o=>o.replaceAll(n,t))}},St=At;var Dt=class extends _{decode_chain(e){return[e.join("")]}},Ot=Dt;var Rt=class extends _{constructor(e){super(e),this.content=e.content??"",this.start=e.start??0,this.stop=e.stop??0}decode_chain(e){return e.map(t=>{let n=0;for(let s=0;s<this.start&&t[s]===this.content;++s){n=s+1;continue}let o=t.length;for(let s=0;s<this.stop;++s){let a=t.length-s-1;if(t[a]===this.content){o=a;continue}else break}return t.slice(n,o)})}},$t=Rt;var Mt=class extends _{constructor(e){super(e),this.text_decoder=new TextDecoder}decode_chain(e){let t=[],n=[];for(let o of e){let s=null;if(o.length===6&&o.startsWith("<0x")&&o.endsWith(">")){let a=parseInt(o.slice(3,5),16);isNaN(a)||(s=a)}if(s!==null)n.push(s);else{if(n.length>0){let a=this.text_decoder.decode(Uint8Array.from(n));t.push(a),n=[]}t.push(o)}}if(n.length>0){let o=this.text_decoder.decode(Uint8Array.from(n));t.push(o),n=[]}return t}},Bt=Mt;function Fr(r){if(r===null)return null;switch(r.type){case"ByteLevel":return new zt(r);case"WordPiece":return new xt(r);case"Metaspace":return new yt(r);case"BPEDecoder":return new Pt(r);case"CTC":return new vt(r);case"Sequence":return new Et(r);case"Replace":return new St(r);case"Fuse":return new Ot(r);case"Strip":return new $t(r);case"ByteFallback":return new Bt(r);default:throw new Error(`Unknown Decoder type: ${r.type}`)}}var X=Fr;var Ft=class{constructor(e,t){let n=Q(e,"Tokenizer",["model","decoder","post_processor","pre_tokenizer","normalizer"]);if(n)throw new Error(n);let o=Q(t,"Config");if(o)throw new Error(o);this.tokenizer=e,this.config=t,this.normalizer=L(this.tokenizer.normalizer),this.pre_tokenizer=U(this.tokenizer.pre_tokenizer),this.model=_r(this.tokenizer.model,this.config),this.post_processor=K(this.tokenizer.post_processor),this.decoder=X(this.tokenizer.decoder),this.special_tokens=[],this.all_special_ids=[],this.added_tokens=[];let s=[],a=[];this.added_tokens_map=new Map;for(let i of this.tokenizer.added_tokens){let c=new Z(i);if(this.added_tokens.push(c),this.model.tokens_to_ids.set(c.content,c.id),this.model.vocab[c.id]=c.content,c.special&&(this.special_tokens.push(c.content),this.all_special_ids.push(c.id)),this.added_tokens_map.set(c.content,c),c.normalized&&this.normalizer!==null){let l=this.normalizer(c.content);a.push(l),this.added_tokens_map.set(l,c)}else s.push(c.content)}(this.config.additional_special_tokens??[]).forEach(i=>{this.special_tokens.includes(i)||this.special_tokens.push(i)}),this.decoder&&(this.decoder.added_tokens=this.added_tokens,this.decoder.end_of_word_suffix=this.model.end_of_word_suffix),this.splitter_unnormalized=new G(s),this.splitter_normalized=new G(a),this.remove_space=this.config.remove_space,this.clean_up_tokenization_spaces=this.config.clean_up_tokenization_spaces??!0,this.do_lowercase_and_remove_accent=this.config.do_lowercase_and_remove_accent??!1}encode(e,{text_pair:t=null,add_special_tokens:n=!0,return_token_type_ids:o=null}={}){let{tokens:s,token_type_ids:a}=this.tokenize_helper(e,{text_pair:t,add_special_tokens:n}),i=s.map(l=>this.added_tokens_map.get(l)?.id??this.model.tokens_to_ids.get(l)??this.model.unk_token_id),c={ids:i,tokens:s,attention_mask:new Array(i.length).fill(1)};return o&&a&&(c.token_type_ids=a),c}decode(e,t={}){if(!Array.isArray(e)||e.length===0||!rr(e[0]))throw Error("token_ids must be a non-empty array of integers.");let n=e.map(s=>this.model.vocab[Number(s)]??this.model.unk_token);t.skip_special_tokens&&(n=n.filter(s=>!this.special_tokens.includes(s)));let o=this.decoder?this.decoder(n):n.join(" ");return this.decoder&&this.decoder.end_of_word_suffix&&(o=o.replaceAll(this.decoder.end_of_word_suffix," "),t.skip_special_tokens&&(o=o.trim())),(t.clean_up_tokenization_spaces??this.clean_up_tokenization_spaces)&&(o=D(o)),o}tokenize(e,{text_pair:t=null,add_special_tokens:n=!1}={}){return this.tokenize_helper(e,{text_pair:t,add_special_tokens:n}).tokens}encode_text(e){if(e===null)return null;let t=this.splitter_unnormalized.split(e);return t.forEach((n,o)=>{let s=this.added_tokens_map.get(n);s&&(s.lstrip&&o>0&&(t[o-1]=t[o-1].trimEnd()),s.rstrip&&o<t.length-1&&(t[o+1]=t[o+1].trimStart()))}),t.flatMap((n,o)=>{if(n.length===0)return[];if(this.added_tokens_map.has(n))return[n];if(this.remove_space===!0&&(n=n.trim().split(/\s+/).join(" ")),this.do_lowercase_and_remove_accent&&(n=or(n)),this.normalizer!==null&&(n=this.normalizer(n)),n.length===0)return[];let s=this.splitter_normalized.split(n);return s.forEach((a,i)=>{let c=this.added_tokens_map.get(a);c&&(c.lstrip&&i>0&&(s[i-1]=s[i-1].trimEnd()),c.rstrip&&i<s.length-1&&(s[i+1]=s[i+1].trimStart()))}),s.flatMap(a=>{if(a.length===0)return[];if(this.added_tokens_map.has(a))return[a];let i=this.pre_tokenizer!==null?this.pre_tokenizer(a,{section_index:o}):[a];return this.model(i)})})}tokenize_helper(e,{text_pair:t=null,add_special_tokens:n=!0}){let o=this.encode_text(e),s=this.encode_text(t||null);return this.post_processor?this.post_processor(o,s,n):{tokens:k(o??[],s??[])}}token_to_id(e){return this.model.tokens_to_ids.get(e)}id_to_token(e){return this.model.vocab[e]}get_added_tokens_decoder(){let e=new Map;for(let t of this.added_tokens)e.set(t.id,t);return e}get_vocab(e=!0){let t=new Map;for(let n=0;n<this.model.vocab.length;++n){let o=this.model.vocab[n];(e||!this.added_tokens_map.has(o))&&t.set(o,n)}return t}},Lr=Ft;return {AddedToken: Z,BPE: q,BPEDecoder: Pt,BertNormalizer: ne,BertPreTokenizer: Ie,BertProcessingPostProcessor: ut,ByteFallbackDecoder: Bt,ByteLevelDecoder: zt,ByteLevelPostProcessor: pt,ByteLevelPreTokenizer: Ae,CTCDecoder: vt,Decoder: _,DigitsPreTokenizer: Ue,FixedLengthPreTokenizer: Ze,FuseDecoder: Ot,LowercaseNormalizer: we,MetaspaceDecoder: yt,MetaspacePreTokenizer: Re,Model: P,NFCNormalizer: ue,NFDNormalizer: _e,NFKCNormalizer: me,NFKDNormalizer: ke,Normalizer: h,PostProcessor: y,PreTokenizer: f,PrecompiledNormalizer: se,PrependNormalizer: Ce,PunctuationPreTokenizer: Fe,ReplaceDecoder: St,ReplaceNormalizer: le,ReplacePreTokenizer: qe,RobertaProcessingPostProcessor: _t,SequenceDecoder: Et,SequenceNormalizer: ae,SequencePostProcessor: mt,SequencePreTokenizer: Xe,SplitPreTokenizer: Me,StripAccentsNormalizer: Te,StripDecoder: $t,StripNormalizer: be,TemplateProcessingPostProcessor: ct,Tokenizer: Lr,Unigram: j,WhitespacePreTokenizer: De,WhitespaceSplitPreTokenizer: Ge,WordPiece: W,WordPieceDecoder: xt};;

})();
// ---- vendor/mp4mux.js
__M["vendor/mp4mux.js"] = (() => {
// mp4mux.js - minimal MP4 (ISO BMFF) muxer for ONE H.264 track (WebCodecs EncodedVideoChunks + the avcC record).
// Layout: ftyp | mdat (all samples) | moov.  One chunk, constant frame duration, sync samples listed in stss.
// Drafted by the local Qwen assist lane, corrected by Claude (missing mvhd pre_defined, tkhd volume, hdlr reserved fields; stco
// offset computed up front; mdat written without spreading).  Part of the Pocket Flux engine (same licence as the engine).
'use strict';

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const str = (s) => Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Array(n).fill(0);
const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
const fullbox = (type, ver, flags, ...parts) => box(type, u32(((ver & 255) << 24) | (flags & 0xffffff)), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].flatMap(u32);

/** {width, height, fps, avcC: Uint8Array, samples: [{data: Uint8Array, key: boolean}], codec ('avc1…' | 'vp09…')} -> Uint8Array (.mp4) */
function muxMp4({ width, height, fps, avcC, samples, codec = 'avc1' }) {
  const n = samples.length, ts = Math.round(fps * 1000), movieDur = Math.round(n * 1000 / fps), mediaDur = n * 1000, vp9 = /^vp09/.test(codec);
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str(vp9 ? 'vp09' : 'avc1'), str('mp41'));
  const dataLen = samples.reduce((s, x) => s + x.data.length, 0), firstSample = ftyp.length + 8;
  const mvhd = fullbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), u16(0), zeros(8), MATRIX, zeros(24), u32(2));
  const tkhd = fullbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16));
  const mdhd = fullbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(mediaDur), u16(0x55c4), u16(0));
  const hdlr = fullbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), [0]);
  const vmhd = fullbox('vmhd', 0, 1, zeros(8));
  const dinf = box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
  // p0pc0rn v026.9: VP9 (no H.264 encoder): 'vp09' + vpcC v1 (profile, level and bit depth from the codec string; 4:2:0, BT.709, limited range)
  const vpp = vp9 ? codec.split('.') : null;
  const avc1 = vp9 ? box('vp09', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
      fullbox('vpcC', 1, 0, [Number(vpp[1]) || 0], [Number(vpp[2]) || 31], [((Number(vpp[3]) || 8) << 4) | (1 << 1) | 0], [1], [1], [1], u16(0)))
    : box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
      box('avcC', Array.from(avcC)));
  const keys = []; samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  const stbl = box('stbl', fullbox('stsd', 0, 0, u32(1), avc1), fullbox('stts', 0, 0, u32(1), u32(n), u32(1000)),
    fullbox('stss', 0, 0, u32(keys.length), keys.map(u32)), fullbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    fullbox('stsz', 0, 0, u32(0), u32(n), samples.map((s) => u32(s.data.length))), fullbox('stco', 0, 0, u32(1), u32(firstSample)));
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl))));
  const out = new Uint8Array(ftyp.length + 8 + dataLen + moov.length);
  out.set(ftyp, 0); out.set(u32(8 + dataLen), ftyp.length); out.set(str('mdat'), ftyp.length + 4);
  let o = firstSample; for (const s of samples) { out.set(s.data, o); o += s.data.length; }
  out.set(moov, o);
  return out;
}

return { muxMp4 };
})();
// ---- core/gpu.js
__M["core/gpu.js"] = (() => {
// Pocket Flux engine core: device, buffer accounting, pipeline cache, batched dispatch runner.
// Pure JS (ES module), no dependencies, no wasm.  See docs/ARCHITECTURE.md section 2.
'use strict';

const U = () => GPUBufferUsage;
const MB = 1e6;

class GpuError extends Error {}

/** Create the GPU context.  opts: {powerPreference, wantSubgroups=true, wantF16=true, maxDispatchSeconds=0.2, onLost(info)} */
async function createGpu(opts = {}) {
  if (!globalThis.navigator || !navigator.gpu) throw new GpuError('WebGPU is not available (navigator.gpu missing)');
  const g = new Gpu(opts);
  await g.init();
  return g;
}

/** v026.9: workgroup bytes a WGSL module declares (arrays of scalars / vectors; unknown element types count 4 bytes) */
function wgBytesOf(code) {
  const SZ = { f16: 2, f32: 4, i32: 4, u32: 4, 'vec2<f16>': 4, 'vec4<f16>': 8, 'vec2<f32>': 8, 'vec2<u32>': 8, 'vec4<f32>': 16, 'vec4<u32>': 16, 'vec3<f32>': 16, 'atomic<u32>': 4, 'atomic<i32>': 4 };
  const re = /var<workgroup>\s+\w+\s*:\s*(array<\s*([a-z0-9<>]+)\s*,\s*(\d+)\s*>|[a-z0-9<>]+)\s*;/g; let m, n = 0;
  while ((m = re.exec(code))) n += m[2] ? (SZ[m[2]] || 4) * Number(m[3]) : (SZ[m[1]] || 4);
  return n;
}
class Gpu {
  constructor(opts) {
    this.opts = Object.assign({ powerPreference: 'high-performance', wantSubgroups: true, wantF16: true, maxDispatchSeconds: 0.2 }, opts);
    this.alive = 0; this.peak = 0; this.bufs = new Set();
    // p0pc0rn v026.2: the reuse pool (see buffer / free); hw = the most live bytes this device ever held (the pool's cap with the live ones)
    this.pool = new Map(); this.pooled = 0; this.pooledN = 0; this.hw = 0; this.maxBuf = 0; this.ps = { creates: 0, reuses: 0, evictions: 0 }; this.poolSeq = 0;
    this.pipes = new Map();
    this.lostInfo = null;
    // FLOP/s assumed for dispatch sizing until calibrate() measures it (conservative = the slow desktop iGPU)
    this.rate = { mm: 0.2e12, attn: 0.08e12, mem: 20e9 };
  }

  async init() {
    const ad = await navigator.gpu.requestAdapter({ powerPreference: this.opts.powerPreference });
    if (!ad) throw new GpuError('no WebGPU adapter');
    this.adapter = ad;
    const info = ad.info || {};
    this.info = { vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '' };
    const feats = [];
    this.f16 = ad.features.has('shader-f16');
    if (!this.f16) throw new GpuError('shader-f16 is required (all target devices have it)');
    feats.push('shader-f16');
    this.subgroups = !!(this.opts.wantSubgroups && ad.features.has('subgroups'));
    if (this.subgroups) feats.push('subgroups');
    if (ad.features.has('timestamp-query') && this.opts.timestamps) feats.push('timestamp-query');
    const L = ad.limits;
    const want = {
      maxBufferSize: L.maxBufferSize,
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: L.maxComputeWorkgroupSizeX,
      maxStorageBuffersPerShaderStage: L.maxStorageBuffersPerShaderStage,
    };
    this.device = await ad.requestDevice({ requiredFeatures: feats, requiredLimits: want });
    this.limits = this.device.limits;
    // subgroup size range (Chrome exposes adapter.info.subgroupMinSize / MaxSize); kernels that rely on lane groups of 16 check this
    this.sgMin = info.subgroupMinSize || 0; this.sgMax = info.subgroupMaxSize || 0;
    this.sgOK16 = this.subgroups && this.sgMin >= 16;
    this.device.lost.then((li) => {
      this.lostInfo = { reason: li && li.reason, message: li && li.message, t: Date.now() };
      if (this.opts.onLost) try { this.opts.onLost(this.lostInfo); } catch (e) { /* ignore */ }
    });
    this.device.addEventListener('uncapturederror', (ev) => {
      this.lastError = (ev.error && ev.error.message) || String(ev.error);
      if (this.opts.onError) this.opts.onError(this.lastError); else console.error('[gpu] ' + this.lastError);
    });
    this.runner = new Runner(this);
  }

  get lost() { return !!this.lostInfo; }
  describe() {
    return Object.assign({}, this.info, { f16: this.f16, subgroups: this.subgroups, sgMin: this.sgMin, sgMax: this.sgMax,
      maxBufferMB: Math.round(this.limits.maxBufferSize / 1048576), maxBindMB: Math.round(this.limits.maxStorageBufferBindingSize / 1048576),
      wgMem: this.limits.maxComputeWorkgroupStorageSize, wgInv: this.limits.maxComputeInvocationsPerWorkgroup });
  }

  // ------------------------------------------------------------------ buffers (every live byte is counted; iOS kills the page ~1.5 GB)
  buffer(size, label = '', usage = 0) {
    size = Math.max(16, Math.ceil(size / 16) * 16);
    if (size > this.limits.maxBufferSize) throw new GpuError(`buffer ${label} ${size} B exceeds maxBufferSize`);
    const us = usage || (U().STORAGE | U().COPY_DST | U().COPY_SRC), key = us + ':' + size;
    // p0pc0rn v026.2: a pooled buffer of exactly this size and usage: cleared (zeroed, like a new one) before anything later uses it
    const L = this.pool.get(key);
    if (L && L.length) {
      const b = L.pop(); if (!L.length) this.pool.delete(key);
      this.pooled -= size; this.pooledN--; this.ps.reuses++;
      this.runner.flush();
      const enc = this.device.createCommandEncoder(); enc.clearBuffer(b); this.device.queue.submit([enc.finish()]);
      this.bufs.add(b); this.alive += size;
      if (this.alive > this.peak) this.peak = this.alive;
      if (this.alive > this.hw) this.hw = this.alive;
      return b;
    }
    // a new buffer: pooled + live never above the cap (destroy the oldest pooled ones to make room)
    this._evict(Math.max(this.poolCap(), this.alive + size) - this.alive - size);
    const b = this.device.createBuffer({ size, label, usage: us });
    b._pf = size; b._key = key; this.bufs.add(b); this.alive += size; this.ps.creates++; if (size > this.maxBuf) this.maxBuf = size;
    if (this.alive > this.peak) this.peak = this.alive;
    if (this.alive > this.hw) this.hw = this.alive;
    return b;
  }
  /** p0pc0rn v026.2: a freed buffer goes to the pool if pooled + live stays within the high-water mark; else it is destroyed */
  free(b) {
    if (!b || !this.bufs.has(b)) return;
    this.bufs.delete(b); this.alive -= b._pf;
    if (b._key && !this.lost && this.alive + this.pooled + b._pf <= this.poolCap()) {
      const L = this.pool.get(b._key) || []; L.push(b); this.pool.set(b._key, L); b._seq = ++this.poolSeq;
      this.pooled += b._pf; this.pooledN++;
      return;
    }
    b.destroy();
  }
  /** destroy pooled buffers, oldest first, until at most `room` bytes are pooled */
  _evict(room) {
    if (this.pooled <= room) return;
    const all = []; for (const L of this.pool.values()) for (const b of L) all.push(b);
    all.sort((x, y) => x._seq - y._seq);
    for (const b of all) {
      if (this.pooled <= room) break;
      const L = this.pool.get(b._key); L.splice(L.indexOf(b), 1); if (!L.length) this.pool.delete(b._key);
      this.pooled -= b._pf; this.pooledN--; this.ps.evictions++;
      b.destroy();
    }
  }
  drainPool() { this._evict(0); }
  /** v026.3: the most live bytes this device held + its largest buffer: room for the alternate weight shard of a streamed loop */
  poolCap() { return this.hw + this.maxBuf; }   // (not cap(): that is the dispatch-size cap below)
  poolStats() { return { aliveMB: Math.round(this.alive / 1e6), pooledMB: Math.round(this.pooled / 1e6), bufs: this.bufs.size, pooledN: this.pooledN, creates: this.ps.creates, reuses: this.ps.reuses, evictions: this.ps.evictions, hwMB: Math.round(this.hw / 1e6), capMB: Math.round(this.poolCap() / 1e6) }; }
  freeAll() { for (const b of Array.from(this.bufs)) this.free(b); this.drainPool(); }
  resetPeak() { this.peak = this.alive; }
  /** upload a TypedArray / ArrayBuffer into a NEW buffer (or into dst at dstOff) */
  upload(data, label = '', dst = null, dstOff = 0) {
    const ab = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const b = dst || this.buffer(ab.byteLength, label);
    const n = ab.byteLength - (ab.byteLength % 4);
    if (n) this.device.queue.writeBuffer(b, dstOff, ab.buffer, ab.byteOffset, n);
    if (n < ab.byteLength) { const t = new Uint8Array(4); t.set(ab.subarray(n)); this.device.queue.writeBuffer(b, dstOff + n, t); }
    return b;
  }
  /** read back [off, off+size) of a buffer as an ArrayBuffer (flushes the runner first) */
  async read(buf, off = 0, size = null) {
    this.runner.flush();
    size = size == null ? buf._pf - off : size;
    const n = Math.ceil(size / 4) * 4;
    // p0pc0rn v026.2: ONE reusable staging buffer (grows by powers of two up to 64 MB; bigger reads get their own); reads serialised
    const go = async () => {
      let rb = null, own = false;
      if (n <= 64e6) {
        if (!this._rb || this._rb.size < n) { if (this._rb) this._rb.destroy(); let s2 = 1 << 20; while (s2 < n) s2 *= 2; this._rb = this.device.createBuffer({ size: s2, usage: U().MAP_READ | U().COPY_DST, label: 'readback' }); }
        rb = this._rb;
      } else { rb = this.device.createBuffer({ size: n, usage: U().MAP_READ | U().COPY_DST }); own = true; }
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(buf, off, rb, 0, n);
      this.device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ, 0, n);
      try { return rb.getMappedRange(0, n).slice(0, size); } finally { rb.unmap(); if (own) rb.destroy(); }
    };
    const p = (this._rq || Promise.resolve()).then(go, go);
    this._rq = p.catch(() => {});
    return p;
  }
  async done() {
    this.runner.flush();
    if (this.lost) throw new GpuError('GPU device lost: ' + JSON.stringify(this.lostInfo));
    await this.device.queue.onSubmittedWorkDone();
    if (this.lost) throw new GpuError('GPU device lost: ' + JSON.stringify(this.lostInfo));
  }

  // ------------------------------------------------------------------ pipelines
  pipeline(key, codeFn) {
    let p = this.pipes.get(key);
    if (p) return p;
    const code = codeFn();
    const wl = this.limits && this.limits.maxComputeWorkgroupStorageSize, wb = wl ? wgBytesOf(code) : 0;   // v026.9: fail loudly, never draw garbage
    if (wl && wb > wl) throw new Error(`This GPU allows ${wl} bytes of workgroup memory; the kernel ${key} needs ${wb}`);
    const mod = this.device.createShaderModule({ code, label: key });
    p = this.device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' }, label: key });
    p._key = key; p._code = code; p._mod = mod;
    this.pipes.set(key, p);
    return p;
  }
  async checkPipeline(p) {   // surface WGSL compile errors with line numbers (tests call this)
    const ci = await p._mod.getCompilationInfo();
    const errs = ci.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new GpuError(`WGSL ${p._key}: ` + errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join(' | '));
  }

  /** seconds a dispatch of `flops` FLOPs of kind may take -> max FLOPs per dispatch (~0.2 s, the OS GPU watchdog guard) */
  cap(kind = 'mm') { return this.rate[kind] * this.opts.maxDispatchSeconds; }
}

/** Batches dispatches into command buffers.  Uniform params of a batch live in one uniform buffer written right before submit.
 *  A batch is submitted when its estimated GPU time reaches `batchSeconds` (keeps the GPU fed without long stalls) or it is full. */
class Runner {
  constructor(gpu) {
    this.g = gpu; this.SLOT = 256; this.CAP = 512; this.batchSeconds = 0.08;
    this.pool = []; this.cur = null; this.submits = 0; this.dispatches = 0;
  }
  _begin() {
    const d = this.g.device;
    let ub = this.pool.pop();
    if (!ub) ub = d.createBuffer({ size: this.SLOT * this.CAP, usage: U().UNIFORM | U().COPY_DST, label: 'uniform-batch' });
    this.cur = { enc: d.createCommandEncoder(), pass: null, ub, data: new ArrayBuffer(this.SLOT * this.CAP), n: 0, sec: 0 };
  }
  /** pipeline, list of storage bindings ({buffer, offset, size} | GPUBuffer), params (ArrayBuffer <= 256 B), workgroups [x,y,z], est seconds */
  /** v026.9: a storage binding never larger than maxStorageBufferBindingSize (an open-ended arena view is cut to it) */
  _fit(b) {
    const lim = this.g.limits && this.g.limits.maxStorageBufferBindingSize; if (!lim) return b;
    const buf = b instanceof GPUBuffer ? b : b.buffer, off = b instanceof GPUBuffer ? 0 : (b.offset || 0);
    const size = b instanceof GPUBuffer || b.size == null ? buf.size - off : b.size;
    if (size <= lim) return b;
    this.cuts = (this.cuts || 0) + 1; if (!this.cutLabels) this.cutLabels = new Set(); if (this.cutLabels.size < 32) this.cutLabels.add(String(buf.label || '?'));
    try { const G = globalThis.__pfBindCuts || (globalThis.__pfBindCuts = {}); const k = String(buf.label || '?') + ' ' + Math.round(size / 1048576) + ' MB'; G[k] = (G[k] || 0) + 1; } catch (e) { /* */ }
    return { buffer: buf, offset: off, size: Math.floor(lim / 256) * 256 };
  }
  dispatch(pipe, bindings, params, wg, sec = 0) {
    bindings = bindings.map((b) => this._fit(b));   // v026.9
    if (!this.cur) this._begin();
    const c = this.cur;
    if (!c.pass) c.pass = c.enc.beginComputePass();
    const slot = c.n++;
    new Uint8Array(c.data, slot * this.SLOT, params.byteLength).set(new Uint8Array(params));
    const entries = [{ binding: 0, resource: { buffer: c.ub, offset: slot * this.SLOT, size: this.SLOT } }];
    bindings.forEach((b, i) => entries.push({ binding: i + 1, resource: b instanceof GPUBuffer ? { buffer: b } : b }));
    const bg = this.g.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries });
    c.pass.setPipeline(pipe); c.pass.setBindGroup(0, bg);
    c.pass.dispatchWorkgroups(wg[0], wg[1] || 1, wg[2] || 1);
    c.sec += sec; this.dispatches++;
    if (c.n >= this.CAP || c.sec >= this.batchSeconds) this.flush();
  }
  /** copy between buffers inside the current batch (ends the compute pass) */
  copy(src, srcOff, dst, dstOff, size) {
    if (!this.cur) this._begin();
    const c = this.cur;
    if (c.pass) { c.pass.end(); c.pass = null; }
    c.enc.copyBufferToBuffer(src, srcOff, dst, dstOff, size);
  }
  flush() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (c.pass) c.pass.end();
    const q = this.g.device.queue;
    if (c.n) q.writeBuffer(c.ub, 0, c.data, 0, c.n * this.SLOT);
    q.submit([c.enc.finish()]);
    this.submits++;
    q.onSubmittedWorkDone().then(() => { if (this.pool.length < 64) this.pool.push(c.ub); else c.ub.destroy(); });   // p0pc0rn v026.2: keep up to 64 (was 8)
  }
}

/** Uniform params helper: P().u32(a).f32(b)... .ab  (all fields 4 B, std140-free because every struct member is a scalar) */
function P() {
  const ab = new ArrayBuffer(256), u = new Uint32Array(ab), f = new Float32Array(ab);
  let i = 0;
  const o = { u32(v) { u[i++] = v >>> 0; return o; }, i32(v) { u[i++] = v | 0; return o; }, f32(v) { f[i++] = v; return o; },
    get ab() { return ab.slice(0, Math.max(16, Math.ceil(i / 4) * 16)); }, get n() { return i; } };
  return o;
}

/** binding helper: a tensor view {buffer, offset, size} with 4-byte multiple size */
function view(buffer, offset = 0, size = null) {
  size = size == null ? buffer._pf - offset : size;
  return { buffer, offset, size: Math.ceil(size / 4) * 4 };
}

// ------------------------------------------------------------------ fp16 helpers (CPU side)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function f2h(v) {
  _f[0] = v; const x = _u[0];
  const sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff; let m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const ne = e - 112;
  if (ne >= 0x1f) return sign | 0x7c00;
  if (ne <= 0) {
    if (ne < -10) return sign;
    m |= 0x800000; const sh = 14 - ne; let hm = m >>> sh; const rem = m & ((1 << sh) - 1), half = 1 << (sh - 1);
    if (rem > half || (rem === half && (hm & 1))) hm++;
    return sign | hm;
  }
  let r = sign | (ne << 10) | (m >>> 13); const rem2 = m & 0x1fff;
  if (rem2 > 0x1000 || (rem2 === 0x1000 && (r & 1))) r++;
  return r;
}
function h2f(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}
function toF16(f32arr) { const o = new Uint16Array(f32arr.length); for (let i = 0; i < f32arr.length; i++) o[i] = f2h(f32arr[i]); return o; }
function fromF16(u16) { const o = new Float32Array(u16.length); for (let i = 0; i < u16.length; i++) o[i] = h2f(u16[i]); return o; }

return { MB, GpuError, createGpu, Gpu, Runner, P, view, f2h, h2f, toF16, fromF16 };
})();
// ---- ops/gemm.js
__M["ops/gemm.js"] = (() => {
// Pocket Flux GEMM family:  Y[m, n] = sum_k X'[m, k] * W[n, k]   (y = x W^T), weights in pack encodings (docs/FORMAT.md 5),
// dequantised INSIDE the kernel (codes -> fp16 tile in workgroup memory, never expanded in device memory).
// fp16 tiles, fp32 accumulation (acc:'f16' variant = fp16 partial sums per 32-k step, for autotune only).
//
// Prologues (x):  'f16'   X fp16 row-major [M, ldx]
//                 'lnmod' X fp32 residual; X' = (x - mean[m]) * rstd[m] * (1 + scale[k]) + shift[k]    (LayerNorm + adaLN modulation fused)
//                 'rms'   X fp32 residual; X' = x * rstd[m] * w[k]                                     (RMSNorm fused)
//                 'conv'  implicit-GEMM conv over an HWC fp16 image (3x3 / 1x1, stride 1/2, fused nearest-2x upsample,
//                         optional fused GroupNorm-apply + SiLU: X' = silu(a[c] * x + b[c]), zero padding applied AFTER it)
// Epilogues (epi): 'f16' | 'f32' store;  'resadd' R_f32 += gate[n] * acc (fp32 residual, gate optional);
//                 'swiglu' (weight rows [gate | up]) Y = silu(gate) * up;  'heads' QK-RMSNorm + RoPE + head-major Q/K/V write;
//                 'bias' fp16 store of acc + bias[n] (+ residual Y in place when res=true)  (VAE convs / linears)
//                 resadd / swiglu take an optional bias vector bv {buf, off, up} (SANA linears have biases); resadd store:true writes
//                 Y = gate * (acc + bias) instead of adding; swiglu act:'gelu' = GeGLU (Gemma-2, tanh GELU)
'use strict';
const { P } = __M["core/gpu.js"];
const DEFAULT_TILE = { BM: 64, BN: 128 };

function keyOf(c) {
  return ['gemm', c.w, c.x, c.epi, c.BM, c.BN, c.acc || 'f32', c.rope || '-', c.sg ? 'sg' : '', c.gate ? 'g' : '', c.res ? 'r' : '',
    c.gn ? 'gn' : '', c.up2 ? 'up' : '', c.pn ? 'pn' : '', c.bias ? 'b' : '', c.store ? 'st' : '', c.act === 'gelu' ? 'gelu' : ''].join('.');
}

function gemmCode(c) {
  const BM = c.BM, BN = c.BN, TM = 8, TN = 8, TX = BN / TN, TY = BM / TM, NT = TX * TY;
  if (NT > 256 || BM % 32 || BN % 64) throw new Error('bad tile ' + BM + 'x' + BN);
  const split = c.epi === 'heads' && c.rope === 'half';
  const xf32 = c.x === 'lnmod' || c.x === 'rms';
  const B = [];                       // storage bindings in order (binding i+1)
  const bind = (name, decl) => { B.push(name); return `@group(0) @binding(${B.length}) var<storage, ${decl}`; };
  const L = [];
  L.push('enable f16;');
  if (c.sg) L.push('enable subgroups;');
  L.push(`struct P { M: u32, N: u32, K: u32, ldx: u32, kx0: u32, wR0: u32, wR1: u32, wG: u32, wk0: u32, ldy: u32, ny0: u32, mt0: u32, nt0: u32,
  rowOff: u32, Ltot: u32, Hq: u32, Hkv: u32, eps: f32, pvOff: u32, pvStride: u32, evOff: u32, statOff: u32,
  Hi: u32, Wi: u32, Ci: u32, Ho: u32, Wo: u32, stride: u32, padT: u32, padL: u32, ks: u32, Nw: u32, bvOff: u32, bvUp: u32 };`);
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push(bind('X', `read> X: array<${xf32 ? 'vec4<f32>' : 'vec4<f16>'}>;`));
  L.push(bind('W', 'read> W: array<u32>;'));
  const yT = c.epi === 'f32' || c.epi === 'resadd' ? 'vec4<f32>' : 'vec4<f16>';
  L.push(bind('Y', `${c.epi === 'resadd' || (c.epi === 'bias' && c.res) ? 'read_write' : 'read_write'}> Y: array<${yT}>;`));
  if (xf32 || (c.x === 'conv3' && c.pn)) L.push(bind('ST', 'read> ST: array<f32>;'));
  if (xf32 || (c.x === 'conv' && c.gn)) L.push(bind('PV', 'read> PV: array<vec4<f32>>;'));
  const red128 = c.epi === 'heads' || c.epi === 'onormgate';      // epilogues that reduce over one 128-wide head
  const needEV = (c.epi === 'resadd' && c.gate) || red128 || c.epi === 'bias';
  if (needEV) L.push(bind('EV', 'read> EV: array<f32>;'));
  if (c.epi === 'onormgate') L.push(bind('GT', 'read> GT: array<vec4<f16>>;'));
  if (c.bias) L.push(bind('BV', 'read> BV: array<f32>;'));   // bias vector for 'resadd' (+ store) and 'swiglu' (gate at bvOff, up at bvOff + bvUp)
  if (c.epi === 'heads') L.push(bind('RP', 'read> RP: array<f32>;'));
  L.push(`var<workgroup> xs: array<vec4<f16>, ${32 * BM / 4}>;`);
  L.push(`var<workgroup> ws: array<vec4<f16>, ${32 * BN / 4}>;`);
  if (red128 && !c.sg) L.push(`var<workgroup> red: array<f32, ${BM * TX}>;`);

  // ---- one prologue-applied X vector: row `row`, k = k0 + 4*kq .. +3
  L.push(`fn xload(row: u32, k0: u32, kq: u32) -> vec4<f16> {`);
  if (c.x === 'f16') {
    L.push(`      let v = X[(row * p.ldx + p.kx0 + k0) / 4u + kq];`);
  } else if (xf32) {
    L.push(`      let xv = X[(row * p.ldx + p.kx0 + k0) / 4u + kq];`);
    L.push(`      let sr = (p.statOff + row) * 2u; let kk = (p.kx0 + k0) / 4u + kq;`);
    if (c.x === 'lnmod') L.push(`      let v = vec4<f16>((xv - vec4<f32>(ST[sr])) * ST[sr + 1u] * (vec4<f32>(1.0) + PV[p.pvOff / 4u + kk]) + PV[(p.pvOff + p.pvStride) / 4u + kk]);`);
    else L.push(`      let v = vec4<f16>(xv * ST[sr + 1u] * PV[p.pvOff / 4u + kk]);`);
  } else if (c.x === 'conv3') {   // 3x3x3 conv over THWC, stride 1; time padding = replicate (LTX causal=False), space = zeros; p.stride = Ti
    L.push(`      let HW = p.Ho * p.Wo; let ot = row / HW; let rem = row % HW; let oy = rem / p.Wo; let ox = rem % p.Wo;`);
    L.push(`      let tap = k0 / p.Ci; let c0 = k0 % p.Ci; let kt = tap / 9u; let ky = (tap / 3u) % 3u; let kx = tap % 3u;`);
    // p0pc0rn v029 time chunks: output frame = row frame + padT; the input frame is t - padL (a buffer that starts at frame padL) or
    // t % ks (a ring of ks frames, ks > 1).  padT = padL = 0, ks = 1 is the whole clip, as before.
    L.push(`      let itg = u32(clamp(i32(ot + p.padT + kt) - 1, 0, i32(p.stride) - 1)); let it = select(itg - p.padL, itg % p.ks, p.ks > 1u); let iy = i32(oy + ky) - 1; let ix = i32(ox + kx) - 1;`);
    L.push(`      let ok = iy >= 0 && ix >= 0 && iy < i32(p.Hi) && ix < i32(p.Wi);`);
    L.push(`      let vox = (it * p.Hi + u32(clamp(iy, 0, i32(p.Hi) - 1))) * p.Wi + u32(clamp(ix, 0, i32(p.Wi) - 1));`);
    L.push(`      let xv = X[vox * (p.Ci / 4u) + c0 / 4u + kq];`);
    if (c.pn) {   // LTX PixelNorm (per-voxel rstd over channels) + SiLU, zero padding after the transform
      L.push(`      let z = vec4<f32>(xv) * ST[vox];`);
      L.push(`      let v = select(vec4<f16>(0.0), vec4<f16>(z / (vec4<f32>(1.0) + exp(-z))), ok);`);
    } else L.push(`      let v = select(vec4<f16>(0.0), xv, ok);`);
  } else {   // conv
    L.push(`      let oy = row / p.Wo; let ox = row % p.Wo; let tap = k0 / p.Ci; let c0 = k0 % p.Ci;`);
    L.push(`      let iy = i32(oy * p.stride + tap / p.ks) - i32(p.padT); let ix = i32(ox * p.stride + tap % p.ks) - i32(p.padL);`);
    const HH = c.up2 ? 'i32(p.Hi * 2u)' : 'i32(p.Hi)', WW = c.up2 ? 'i32(p.Wi * 2u)' : 'i32(p.Wi)';
    L.push(`      let ok = iy >= 0 && ix >= 0 && iy < ${HH} && ix < ${WW};`);
    L.push(`      let sy = u32(max(iy, 0))${c.up2 ? ' >> 1u' : ''}; let sx = u32(max(ix, 0))${c.up2 ? ' >> 1u' : ''};`);
    L.push(`      let xv = X[(min(sy, p.Hi - 1u) * p.Wi + min(sx, p.Wi - 1u)) * (p.Ci / 4u) + c0 / 4u + kq];`);
    if (c.gn) {
      L.push(`      let cq = c0 / 4u + kq; let z = vec4<f32>(xv) * PV[p.pvOff / 4u + cq] + PV[(p.pvOff + p.pvStride) / 4u + cq];`);
      L.push(`      let v = select(vec4<f16>(0.0), vec4<f16>(z / (vec4<f32>(1.0) + exp(-z))), ok);`);
    } else L.push(`      let v = select(vec4<f16>(0.0), xv, ok);`);
  }

  L.push('  return v;');
  L.push('}');

  // ---- weight row for ws column cc (0..BN-1) of this workgroup
  L.push(`fn wrow(nb: u32, cc: u32) -> u32 {`);
  if (c.epi === 'swiglu') L.push(`  let o = (nb + cc) >> 1u; return select(p.wR1, p.wR0, (cc & 1u) == 0u) + o;`);
  else L.push(`  return min(p.wR0 + nb + cc, p.Nw - 1u);`);
  L.push('}');

  L.push(`@compute @workgroup_size(${NT})`);
  L.push(`fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32${c.sg ? ', @builtin(subgroup_invocation_id) sgi: u32' : ''}) {`);
  L.push(`  let mB = (wid.y + p.mt0) * ${BM}u; let nB = (wid.x + p.nt0) * ${BN}u;`);
  L.push(`  let tx = li % ${TX}u; let ty = li / ${TX}u;`);
  for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`  var a${r}_${j} = vec4<f32>(0.0);`);
  // p0pc0rn v028: conv3 hoists its voxel indices (rows once per thread, the tap once per 32-k step): bit-identical, iPhone 1.09-1.15x
  const CV3P = c.x === 'conv3' && BM * 2 <= NT;
  if (CV3P) {
    L.push('  let lmP = p.M - 1u; let HWP = p.Ho * p.Wo; let rbP = mB + (li >> 3u) * 4u;');
    L.push('  let r4 = min(vec4<u32>(rbP) + vec4<u32>(0u, 1u, 2u, 3u), vec4<u32>(lmP));');
    L.push('  let cot = r4 / vec4<u32>(HWP); let rem4 = r4 - cot * HWP; let coy = vec4<i32>(rem4 / vec4<u32>(p.Wo)); let cox = vec4<i32>(rem4 % vec4<u32>(p.Wo));');
  }
  L.push(`  for (var k0 = 0u; k0 < p.K; k0 = k0 + 32u) {`);
  // ---- X tile -> xs[k][m/4] (transposed through registers: 4 rows x 4 k per task, WHOLE vec4 stores only.
  //      Never write single components of a shared vec4: on Metal that is a read-modify-write of the vector and races.)
  if (CV3P) {
    L.push(`    if (li < ${BM * 2}u) { let t = li;`);
    L.push('      let mq = t >> 3u; let kq = t & 7u;');
    L.push('      let tap = k0 / p.Ci; let c0 = k0 - tap * p.Ci; let kt = tap / 9u; let r9 = tap - kt * 9u; let ky = r9 / 3u; let kx = r9 - ky * 3u;');
    L.push('      let itg4 = vec4<u32>(clamp(vec4<i32>(cot + vec4<u32>(kt + p.padT)) - 1, vec4<i32>(0), vec4<i32>(i32(p.stride) - 1)));');
    L.push('      let it4 = select(itg4 - vec4<u32>(p.padL), itg4 % vec4<u32>(p.ks), p.ks > 1u);');
    L.push('      let iy4 = coy + i32(ky) - 1; let ix4 = cox + i32(kx) - 1;');
    L.push('      let ok4 = (iy4 >= vec4<i32>(0)) & (ix4 >= vec4<i32>(0)) & (iy4 < vec4<i32>(i32(p.Hi))) & (ix4 < vec4<i32>(i32(p.Wi)));');
    L.push('      let vox4 = (it4 * p.Hi + vec4<u32>(clamp(iy4, vec4<i32>(0), vec4<i32>(i32(p.Hi) - 1)))) * p.Wi + vec4<u32>(clamp(ix4, vec4<i32>(0), vec4<i32>(i32(p.Wi) - 1)));');
    L.push('      let cb = p.Ci / 4u; let co = c0 / 4u + kq;');
    for (let i = 0; i < 4; i++) {
      const cc = 'xyzw'[i];
      L.push(`      let xv${i} = X[vox4.${cc} * cb + co];`);
      if (c.pn) L.push(`      let z${i} = vec4<f32>(xv${i}) * ST[vox4.${cc}]; let v${i} = select(vec4<f16>(0.0), vec4<f16>(z${i} / (vec4<f32>(1.0) + exp(-z${i}))), ok4.${cc});`);
      else L.push(`      let v${i} = select(vec4<f16>(0.0), xv${i}, ok4.${cc});`);
    }
  } else {
  L.push(`    for (var t = li; t < ${BM * 2}u; t = t + ${NT}u) {`);
  L.push(`      let mq = t >> 3u; let kq = t & 7u; let r0 = mB + mq * 4u; let lm = p.M - 1u;`);
  L.push(`      let v0 = xload(min(r0, lm), k0, kq); let v1 = xload(min(r0 + 1u, lm), k0, kq); let v2 = xload(min(r0 + 2u, lm), k0, kq); let v3 = xload(min(r0 + 3u, lm), k0, kq);`);
  }
  L.push(`      let xo = kq * 4u * ${BM / 4}u + mq;`);
  ['x', 'y', 'z', 'w'].forEach((c, j) => L.push(`      xs[xo + ${j * BM / 4}u] = vec4<f16>(v0.${c}, v1.${c}, v2.${c}, v3.${c});`));
  L.push('    }');
  // ---- W tile -> ws[k][n] (dequantised to fp16)
  if (c.w === 'q4') {
    L.push(`    let gi = (p.wk0 + k0) / 32u;`);
    L.push(`    for (var t = li; t < ${BN}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var q: vec4<u32>; var sc: vec4<f32>; var mn: vec4<f32>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let rec = ((r >> 6u) * p.wG + gi) * 320u; let rr = r & 63u;`);
    L.push(`        q[j] = W[rec + rr * 4u + w]; let sm = unpack2x16float(W[rec + 256u + rr]); sc[j] = sm.x; mn[j] = sm.y; }`);
    L.push(`      for (var i = 0u; i < 8u; i = i + 1u) {`);
    L.push(`        let cv = vec4<f32>((q >> vec4<u32>(4u * i)) & vec4<u32>(15u));`);
    L.push(`        ws[(w * 8u + i) * ${BN / 4}u + cq] = vec4<f16>(cv * sc + mn); }`);
    L.push('    }');
  } else if (c.w === 'q8') {
    L.push(`    let gi = (p.wk0 + k0) / 64u; let hf = ((p.wk0 + k0) / 32u) & 1u;`);
    L.push(`    for (var t = li; t < ${BN * 2}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var q: vec4<u32>; var sc: vec4<f32>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let rec = ((r >> 6u) * p.wG + gi) * 1056u; let rr = r & 63u;`);
    L.push(`        q[j] = W[rec + rr * 16u + hf * 8u + w]; let s2 = unpack2x16float(W[rec + 1024u + (rr >> 1u)]); sc[j] = select(s2.x, s2.y, (rr & 1u) == 1u); }`);
    L.push(`      for (var i = 0u; i < 4u; i = i + 1u) {`);
    L.push(`        let cv = vec4<f32>((vec4<i32>(q << vec4<u32>(24u - 8u * i))) >> vec4<u32>(24u));`);
    L.push(`        ws[(w * 4u + i) * ${BN / 4}u + cq] = vec4<f16>(cv * sc); }`);
    L.push('    }');
  } else {   // f16 row-major, wG = row stride in halves
    L.push(`    for (var t = li; t < ${BN * 4}u; t = t + ${NT}u) {`);
    L.push(`      let cq = t % ${BN / 4}u; let w = t / ${BN / 4}u;`);
    L.push(`      var lo: vec4<f16>; var hi: vec4<f16>;`);
    L.push(`      for (var j = 0u; j < 4u; j = j + 1u) { let r = wrow(nB, cq * 4u + j); let h2 = bitcast<vec2<f16>>(W[(r * p.wG + p.wk0 + k0) / 2u + w]); lo[j] = h2.x; hi[j] = h2.y; }`);
    L.push(`      ws[(w * 2u) * ${BN / 4}u + cq] = lo; ws[(w * 2u + 1u) * ${BN / 4}u + cq] = hi;`);
    L.push('    }');
  }
  L.push('    workgroupBarrier();');
  // ---- register-tiled outer product: 8 rows x 8 cols per thread
  const w0 = split ? `ws[kb + tx]` : `ws[kb + tx * 2u]`, w1 = split ? `ws[kb + ${BN / 8}u + tx]` : `ws[kb + tx * 2u + 1u]`;
  if (c.acc === 'f16') for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`    var h${r}_${j} = vec4<f16>(0.0);`);
  L.push(`    for (var k = 0u; k < 32u; k = k + 1u) {`);
  L.push(`      let xb = k * ${BM / 4}u + ty * 2u; let kb = k * ${BN / 4}u;`);
  if (c.acc === 'f16') {
    L.push(`      let x0 = xs[xb]; let x1 = xs[xb + 1u]; let u0 = ${w0}; let u1 = ${w1};`);
    for (let r = 0; r < TM; r++) { const xv = `x${r >> 2}[${r & 3}]`; L.push(`      h${r}_0 = fma(vec4<f16>(${xv}), u0, h${r}_0); h${r}_1 = fma(vec4<f16>(${xv}), u1, h${r}_1);`); }
  } else {
    L.push(`      let x0 = vec4<f32>(xs[xb]); let x1 = vec4<f32>(xs[xb + 1u]); let u0 = vec4<f32>(${w0}); let u1 = vec4<f32>(${w1});`);
    for (let r = 0; r < TM; r++) { const xv = `x${r >> 2}[${r & 3}]`; L.push(`      a${r}_0 = fma(vec4<f32>(${xv}), u0, a${r}_0); a${r}_1 = fma(vec4<f32>(${xv}), u1, a${r}_1);`); }
  }
  L.push('    }');
  if (c.acc === 'f16') for (let r = 0; r < TM; r++) for (let j = 0; j < 2; j++) L.push(`    a${r}_${j} = a${r}_${j} + vec4<f32>(h${r}_${j});`);
  L.push('    workgroupBarrier();');
  L.push('  }');

  // ---- epilogues
  const rows = (fn) => { for (let r = 0; r < TM; r++) L.push(`  { let m = mB + ty * 8u + ${r}u; if (m < p.M) { ${fn(r)} } }`); };
  const col = split ? null : `nB + tx * 8u`;
  if (c.epi === 'f16' || c.epi === 'f32') {
    const T = c.epi === 'f16' ? 'vec4<f16>' : 'vec4<f32>';
    rows((r) => `let b = (m * p.ldy + p.ny0 + ${col}) / 4u; if (${col} < p.N) { Y[b] = ${T}(a${r}_0); } if (${col} + 4u < p.N) { Y[b + 1u] = ${T}(a${r}_1); }`);
  } else if (c.epi === 'resadd') {
    if (c.gate) L.push(`  let gb = p.evOff + ${col}; let g0 = vec4<f32>(EV[gb], EV[gb + 1u], EV[gb + 2u], EV[gb + 3u]); let g1 = vec4<f32>(EV[gb + 4u], EV[gb + 5u], EV[gb + 6u], EV[gb + 7u]);`);
    else L.push('  let g0 = vec4<f32>(1.0); let g1 = g0;');
    if (c.bias) L.push(`  let vb = p.bvOff + ${col}; let c0 = vec4<f32>(BV[vb], BV[vb + 1u], BV[vb + 2u], BV[vb + 3u]); let c1 = vec4<f32>(BV[vb + 4u], BV[vb + 5u], BV[vb + 6u], BV[vb + 7u]);`);
    else L.push('  let c0 = vec4<f32>(0.0); let c1 = c0;');
    const prev = (i) => (c.store ? '' : `Y[${i}] + `);
    rows((r) => `let b = (m * p.ldy + p.ny0 + ${col}) / 4u; if (${col} < p.N) { Y[b] = ${prev('b')}g0 * (a${r}_0 + c0); } if (${col} + 4u < p.N) { Y[b + 1u] = ${prev('b + 1u')}g1 * (a${r}_1 + c1); }`);
  } else if (c.epi === 'swiglu') {
    // ws columns interleave (gate n, up n): a_0 = (g0,u0,g1,u1), a_1 = (g2,u2,g3,u3)
    if (c.bias) L.push(`  let ob = p.bvOff + (nB >> 1u) + tx * 4u; let gB = vec4<f32>(BV[ob], BV[ob + 1u], BV[ob + 2u], BV[ob + 3u]); let uB = vec4<f32>(BV[ob + p.bvUp], BV[ob + p.bvUp + 1u], BV[ob + p.bvUp + 2u], BV[ob + p.bvUp + 3u]);`);
    else L.push('  let gB = vec4<f32>(0.0); let uB = gB;');
    const act = c.act === 'gelu' ? 'g * 0.5 * (vec4<f32>(1.0) + tanh(clamp(0.7978845608 * (g + 0.044715 * g * g * g), vec4<f32>(-15.0), vec4<f32>(15.0))))' : 'g / (vec4<f32>(1.0) + exp(-g))';
    rows((r) => `let g = vec4<f32>(a${r}_0.x, a${r}_0.z, a${r}_1.x, a${r}_1.z) + gB; let u = vec4<f32>(a${r}_0.y, a${r}_0.w, a${r}_1.y, a${r}_1.w) + uB;
      Y[(m * p.ldy + p.ny0 + (nB >> 1u) + tx * 4u) / 4u] = vec4<f16>(${act} * u);`);
  } else if (c.epi === 'bias') {
    L.push(`  let bb = p.evOff + ${col}; let b0 = vec4<f32>(EV[bb], EV[bb + 1u], EV[bb + 2u], EV[bb + 3u]); let b1 = vec4<f32>(EV[bb + 4u], EV[bb + 5u], EV[bb + 6u], EV[bb + 7u]);`);
    rows((r) => `let b = (m * p.ldy + p.ny0 + ${col}) / 4u;
      if (${col} < p.N) { Y[b] = vec4<f16>(a${r}_0 + b0${c.res ? ' + vec4<f32>(Y[b])' : ''}); }
      if (${col} + 4u < p.N) { Y[b + 1u] = vec4<f16>(a${r}_1 + b1${c.res ? ' + vec4<f32>(Y[b + 1u])' : ''}); }`);
  } else if (red128) {
    if (BN !== 128) throw new Error(c.epi + ' epilogue needs BN = 128 (one head per workgroup column)');
    // per-row sum of squares over the 128 head dims (16 threads x 8 cols)
    for (let r = 0; r < TM; r++) L.push(`  var s${r} = dot(a${r}_0, a${r}_0) + dot(a${r}_1, a${r}_1);`);
    if (c.sg) {
      for (let r = 0; r < TM; r++) L.push(`  s${r} = s${r} + subgroupShuffleXor(s${r}, 1u); s${r} = s${r} + subgroupShuffleXor(s${r}, 2u); s${r} = s${r} + subgroupShuffleXor(s${r}, 4u); s${r} = s${r} + subgroupShuffleXor(s${r}, 8u);`);
    } else {
      for (let r = 0; r < TM; r++) L.push(`  red[(ty * 8u + ${r}u) * 16u + tx] = s${r};`);
      L.push('  workgroupBarrier();');
      for (let r = 0; r < TM; r++) L.push(`  { var t = 0.0; for (var i = 0u; i < 16u; i = i + 1u) { t = t + red[(ty * 8u + ${r}u) * 16u + i]; } s${r} = t; }`);
    }
    if (c.epi === 'onormgate') {   // SANA linear attention read-out: o_norm (RMS over the head) * w, * sigmoid(gate)
      L.push(`  let c0 = tx * 8u; let n0 = vec4<f32>(EV[p.evOff + c0], EV[p.evOff + c0 + 1u], EV[p.evOff + c0 + 2u], EV[p.evOff + c0 + 3u]); let n1 = vec4<f32>(EV[p.evOff + c0 + 4u], EV[p.evOff + c0 + 5u], EV[p.evOff + c0 + 6u], EV[p.evOff + c0 + 7u]);`);
      rows((r) => `let inv = inverseSqrt(s${r} / 128.0 + p.eps); let gi = (m * p.Ltot + p.ny0 + nB + c0) / 4u;
        let g0 = vec4<f32>(GT[gi]); let g1 = vec4<f32>(GT[gi + 1u]);
        let b = (m * p.ldy + p.ny0 + nB + c0) / 4u;
        Y[b] = vec4<f16>(a${r}_0 * inv * n0 / (vec4<f32>(1.0) + exp(-g0))); Y[b + 1u] = vec4<f16>(a${r}_1 * inv * n1 / (vec4<f32>(1.0) + exp(-g1)));`);
    } else {
    L.push(`  let hd = nB / 128u; let sec = select(select(2u, 1u, hd < p.Hq + p.Hkv), 0u, hd < p.Hq);`);
    L.push(`  let c0 = ${split ? 'tx * 4u' : 'tx * 8u'}; let nwo = p.evOff + select(128u, 0u, sec == 0u);`);
    if (split) L.push(`  let n0 = vec4<f32>(EV[nwo + c0], EV[nwo + c0 + 1u], EV[nwo + c0 + 2u], EV[nwo + c0 + 3u]); let n1 = vec4<f32>(EV[nwo + c0 + 64u], EV[nwo + c0 + 65u], EV[nwo + c0 + 66u], EV[nwo + c0 + 67u]);`);
    else L.push(`  let n0 = vec4<f32>(EV[nwo + c0], EV[nwo + c0 + 1u], EV[nwo + c0 + 2u], EV[nwo + c0 + 3u]); let n1 = vec4<f32>(EV[nwo + c0 + 4u], EV[nwo + c0 + 5u], EV[nwo + c0 + 6u], EV[nwo + c0 + 7u]);`);
    rows((r) => {
      let s = `let row = p.rowOff + m; var v0 = a${r}_0; var v1 = a${r}_1;
      if (sec < 2u) { let inv = inverseSqrt(s${r} / 128.0 + p.eps); v0 = v0 * inv * n0; v1 = v1 * inv * n1;`;
      if (split) {   // Qwen rotate_half: pair (d, d+64), angle index d
        s += ` let rb = row * 128u + c0 * 2u; let cs = vec4<f32>(RP[rb], RP[rb + 2u], RP[rb + 4u], RP[rb + 6u]); let sn = vec4<f32>(RP[rb + 1u], RP[rb + 3u], RP[rb + 5u], RP[rb + 7u]);
        let lo = v0 * cs - v1 * sn; let hi = v1 * cs + v0 * sn; v0 = lo; v1 = hi; }
        let ob = (hd * p.Ltot + row) * 32u + tx; Y[ob] = vec4<f16>(v0); Y[ob + 16u] = vec4<f16>(v1);`;
      } else {       // FLUX interleaved pairs (2p, 2p+1), pair index p = col/2
        s += ` let rb = row * 128u + c0; let c4 = vec4<f32>(RP[rb], RP[rb + 2u], RP[rb + 4u], RP[rb + 6u]); let s4 = vec4<f32>(RP[rb + 1u], RP[rb + 3u], RP[rb + 5u], RP[rb + 7u]);
        v0 = vec4<f32>(v0.x * c4.x - v0.y * s4.x, v0.x * s4.x + v0.y * c4.x, v0.z * c4.y - v0.w * s4.y, v0.z * s4.y + v0.w * c4.y);
        v1 = vec4<f32>(v1.x * c4.z - v1.y * s4.z, v1.x * s4.z + v1.y * c4.z, v1.z * c4.w - v1.w * s4.w, v1.z * s4.w + v1.w * c4.w); }
        let ob = (hd * p.Ltot + row) * 32u + tx * 2u; Y[ob] = vec4<f16>(v0); Y[ob + 1u] = vec4<f16>(v1);`;
      }
      return s;
    });
  }
    }
  L.push('}');
  return { code: L.join('\n'), bindings: B };
}

/**
 * Run a GEMM.  a = {
 *   w: {buf, off, enc:'q4g32a.t64'|'q8g64s.t64'|'f16', rows (Nw), cols (Ktot)}   weight tensor (whole tensor; sub-ranges via r0/r1/k0)
 *   x: {buf, off, ld, k0=0, dtype}  activations;  M, N (output/ws columns of this call), K (reduction length)
 *   wr0=0 (first weight row), wr1 (swiglu: first 'up' row), wk0=0 (first k column of the weight)
 *   epi, y: {buf, off, ld, n0=0}, gate/bias/norm vectors: ev {buf, off(floats)}, stats {buf, off(rows)}, pv {buf, off(floats), stride(floats)}
 *   heads: {Ltot, Hq, Hkv, rowOff, eps, rope: {buf, off}}; conv: {Hi, Wi, Ci, Ho, Wo, stride, padT, padL, ks, up2, gn}
 *   tile: {BM, BN}, acc }
 */
function gemm(gpu, a) {
  const enc = a.w.enc;
  const w = enc === 'q4g32a.t64' ? 'q4' : enc === 'q8g64s.t64' ? 'q8' : enc === 'f16' ? 'f16' : null;
  if (!w) throw new Error('gemm: unsupported weight encoding ' + enc);
  const tile = a.tile || gpu.tune?.gemm?.[w] || DEFAULT_TILE;
  const cv = a.conv || null;
  const cfg = { w, x: cv ? (cv.kind === 'conv3' ? 'conv3' : 'conv') : (a.x.mode || 'f16'), epi: a.epi || 'f16', BM: tile.BM, BN: (a.epi === 'heads' || a.epi === 'onormgate') ? 128 : tile.BN,
    acc: a.acc || (gpu.tune && gpu.tune.acc) || 'f32', rope: a.heads ? a.heads.ropeMode : undefined, sg: (a.epi === 'heads' || a.epi === 'onormgate') && gpu.sgOK16, pn: !!(cv && cv.pn),
    gate: !!a.ev && a.epi === 'resadd', res: !!a.res, gn: !!(cv && cv.gn), up2: !!(cv && cv.up2), bias: !!a.bv, store: !!a.store, act: a.act || 'silu' };
  const key = keyOf(cfg);
  let meta = gpu._gemmMeta || (gpu._gemmMeta = new Map());
  const pipe = gpu.pipeline(key, () => { const g = gemmCode(cfg); meta.set(key, g.bindings); return g.code; });
  const bnames = meta.get(key);
  const M = a.M, N = a.N, K = a.K;
  if (K % 32) throw new Error('gemm: K must be a multiple of 32');
  const Ktot = a.w.cols, wG = w === 'q4' ? Ktot / 32 : w === 'q8' ? Ktot / 64 : (a.w.ld || Ktot);
  const BMt = cfg.BM, BNt = cfg.BN;
  const ntiles = Math.ceil(N / BNt), mtiles = Math.ceil(M / BMt);
  const flopsTile = 2 * BMt * BNt * K;
  const rmm = (cfg.acc === 'f16' ? gpu.rate.mm16 : gpu.rate.mm32) || gpu.rate.mm;   // each accumulate mode has its own measured rate
  const cap = rmm * gpu.opts.maxDispatchSeconds;
  // split: whole N per dispatch if possible, rows chunked; else split N as well
  let nPer = ntiles, mPer = Math.max(1, Math.floor(cap / (flopsTile * ntiles)));
  if (mPer < 1 || flopsTile * ntiles > cap) { mPer = 1; nPer = Math.max(1, Math.floor(cap / flopsTile)); }
  const h = a.heads || {}, c = cv || {};
  // v026.9: a vector inside a buffer larger than one binding (a bias in a 139 MB shard) is bound from the 256-byte boundary before it
  const lim = (gpu.limits && gpu.limits.maxStorageBufferBindingSize) || Infinity;
  const win = (t) => {
    if (!t) return [null, 0];
    const sz = t.buf._pf || t.buf.size, off = t.off || 0;
    if (sz <= lim) return [{ buffer: t.buf }, off];
    const byte = off * 4, base = Math.floor(byte / 256) * 256, n = Math.min(lim, sz - base);
    return [{ buffer: t.buf, offset: base, size: n - (n % 16) }, (byte - base) / 4];
  };
  const [vST, oST] = win(a.stats), [vPV, oPV] = win(a.pv), [vEV, oEV] = win(a.ev), [vBV, oBV] = win(a.bv);
  const views = {
    X: { buffer: a.x.buf, offset: a.x.off || 0, size: (a.x.size != null ? a.x.size : a.x.buf._pf - (a.x.off || 0)) },
    W: { buffer: a.w.buf, offset: a.w.off || 0, size: a.w.bytes },
    Y: { buffer: a.y.buf, offset: a.y.off || 0, size: (a.y.size != null ? a.y.size : a.y.buf._pf - (a.y.off || 0)) },
    ST: vST, PV: vPV, EV: vEV,
    RP: h.rope && { buffer: h.rope.buf }, GT: a.gt && { buffer: a.gt.buf }, BV: vBV,
  };
  for (const k in views) if (views[k] && views[k].size == null) views[k].size = views[k].buffer._pf;
  for (const k in views) if (views[k]) views[k].size = Math.floor(views[k].size / 16) * 16 || 16;
  const binds = bnames.map((n) => { if (!views[n]) throw new Error('gemm: missing binding ' + n + ' for ' + key); return views[n]; });
  for (let m0 = 0; m0 < mtiles; m0 += mPer) {
    for (let n0 = 0; n0 < ntiles; n0 += nPer) {
      const mt = Math.min(mPer, mtiles - m0), nt = Math.min(nPer, ntiles - n0);
      const pr = P().u32(M).u32(N).u32(K).u32(a.x.ld || K).u32(a.x.k0 || 0).u32(a.wr0 || 0).u32(a.wr1 || 0).u32(wG).u32(a.wk0 || 0)
        .u32(a.y.ld || N).u32(a.y.n0 || 0).u32(m0).u32(n0)
        .u32(h.rowOff || 0).u32(h.Ltot || 0).u32(h.Hq || 0).u32(h.Hkv || 0).f32(h.eps || 1e-6)
        .u32(a.pv ? oPV : 0).u32(a.pv ? a.pv.stride || 0 : 0).u32(a.ev ? oEV : 0).u32(a.stats ? oST : 0)
        .u32(c.Hi || 0).u32(c.Wi || 0).u32(c.Ci || 0).u32(c.Ho || 0).u32(c.Wo || 0).u32(c.stride || 1).u32(c.padT || 0).u32(c.padL || 0).u32(c.ks || 1)
        .u32(a.w.rows).u32(a.bv ? oBV : 0).u32(a.bv ? a.bv.up || 0 : 0);
      gpu.runner.dispatch(pipe, binds, pr.ab, [nt, mt], (flopsTile * mt * nt) / rmm);
    }
  }
  return 2 * M * N * K;
}

return { DEFAULT_TILE, gemmCode, gemm };
})();
// ---- ops/attention.js
__M["ops/attention.js"] = (() => {
// Flash attention, head_dim 128, fp16 tiles in workgroup memory, fp32 scores / online-softmax statistics / accumulators.
// The L x L score matrix never leaves the workgroup.  Q [Hq][Lq][128] f16, K/V [Hkv][Lk][128] f16 (head-major, as written by
// the GEMM 'heads' epilogue), O [Lq][ldo] f16 token-major at column h*128 (the input layout of the projection GEMM).
// mask: 0 = none (FLUX DiT), 1 = causal + valid length (Qwen TE: key j visible to query i iff j <= min(i, nvalid-1)),
//       2 = valid length only (cross-attention to padded text keys).
// GQA: query head h reads kv head h / (Hq/Hkv).
// Variants: {BQ:32} (row-owner softmax, portable); {BQ:64} (scores stay in registers, row max/sum via a 2 KB shared reduce,
// P stored fp16; no subgroups needed - Safari has none); {sg:true} uses subgroupShuffleXor for the row reduce instead;
// pv16 = fp16 P*V partial sums per 32-key tile; s16 = fp16 QK partials per 32-dim chunk (scores/softmax stats stay fp32).
// RULE: never store a single component of a shared vec4 (Metal read-modify-writes the vector and races); transpose in registers.
'use strict';
const { P } = __M["core/gpu.js"];
function attnCode(c) {
  const BQ = c.BQ, NT = (BQ / 4) * 8, Q4 = BQ / 4, sg = !!c.sg;
  const kvShared = BQ === 64 || !!c.kvs;   // v026.9: kvs = V reuses the K tile (the 16 KB variant)
  const reg = sg || BQ === 64;   // BQ64 keeps scores in registers (P stored f16): subgroup shuffles, or a small shared reduce
  const pT = BQ === 64 ? 'f16' : 'f32';
  const L = [];
  L.push('enable f16;'); if (sg) L.push('enable subgroups;');
  L.push('struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, p0: u32, p1: u32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push(`var<workgroup> qT: array<vec4<f16>, ${128 * Q4}>;`);          // [d][q/4]
  L.push(`var<workgroup> kT: array<vec4<f16>, 1024>;`);                   // [d][key/4]  (32 keys)
  if (!kvShared) L.push(`var<workgroup> vS: array<vec4<f16>, 1024>;`);    // [key][d/4]
  L.push(`var<workgroup> pS: array<${pT}, ${32 * BQ}>;`);                  // [key][q]
  if (!reg) L.push(`var<workgroup> mS: array<f32, ${BQ}>; var<workgroup> lS: array<f32, ${BQ}>; var<workgroup> aS: array<f32, ${BQ}>;`);
  if (reg && !sg) L.push(`var<workgroup> rS: array<f32, ${BQ * 8}>;`);
  const VS = kvShared ? 'kT' : 'vS';
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push(`  let h = wid.y + p.h0; let hk = h / (p.Hq / p.Hkv); let q0 = (wid.x + p.qt0) * ${BQ}u;`);
  L.push('  let qb = h * p.Lq * 32u; let kb = hk * p.Lk * 32u;');
  L.push('  let ty = li / 8u; let tx = li % 8u;');
  // Q tile, transposed through registers (4 queries x 4 dims per task) with WHOLE vec4 stores: a single-component store
  // into a shared vec4 is a read-modify-write of the vector on Metal and races with the neighbouring lanes.
  L.push(`  for (var t = li; t < ${BQ * 8}u; t = t + ${NT}u) { let qq4 = t / 32u; let d4 = t % 32u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;`);
  L.push('    let a = Qb[qb + min(qa, lq) * 32u + d4]; let b = Qb[qb + min(qa + 1u, lq) * 32u + d4]; let c = Qb[qb + min(qa + 2u, lq) * 32u + d4]; let e = Qb[qb + min(qa + 3u, lq) * 32u + d4];');
  L.push(`    let o = d4 * 4u * ${Q4}u + qq4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[o + ${j * Q4}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  L.push(`  var kEnd = p.Lk; if (p.mode == 1u) { kEnd = min(p.Lk, min(q0 + ${BQ - 1}u, p.nvalid - 1u) + 1u); } if (p.mode == 2u) { kEnd = min(p.Lk, p.nvalid); }`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`  var o${r}${cI} = vec4<f32>(0.0);`);
  if (reg) for (let r = 0; r < 4; r++) L.push(`  var m${r} = -1.0e30; var l${r} = 0.0;`);
  else L.push(`  if (li < ${BQ}u) { mS[li] = -1.0e30; lS[li] = 0.0; }`);
  L.push('  for (var k0 = 0u; k0 < kEnd; k0 = k0 + 32u) {');
  L.push('    workgroupBarrier();');
  L.push(`    for (var t = li; t < 256u; t = t + ${NT}u) { let kk4 = t / 32u; let d4 = t % 32u; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;`);
  L.push('      let a = Kb[kb + min(ka, lk) * 32u + d4]; let b = Kb[kb + min(ka + 1u, lk) * 32u + d4]; let c = Kb[kb + min(ka + 2u, lk) * 32u + d4]; let e = Kb[kb + min(ka + 3u, lk) * 32u + d4];');
  L.push('      let o = d4 * 32u + kk4;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      kT[o + ${j * 8}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('    }');
  if (!kvShared) L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { vS[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
  L.push('    workgroupBarrier();');
  // scores for rows ty*4..+3, keys tx*4..+3
  for (let r = 0; r < 4; r++) L.push(`    var s${r} = vec4<f32>(0.0);`);
  if (c.s16) {   // fp16 partial dot products over 32-dim chunks, flushed to fp32 (scores and softmax stats stay fp32)
    L.push('    for (var dc = 0u; dc < 128u; dc = dc + 32u) {');
    for (let r = 0; r < 4; r++) L.push(`      var h${r} = vec4<f16>(0.0);`);
    L.push(`      for (var d = dc; d < dc + 32u; d = d + 1u) { let qv = qT[d * ${Q4}u + ty]; let kv = kT[d * 8u + tx];`);
    for (let r = 0; r < 4; r++) L.push(`        h${r} = fma(vec4<f16>(qv[${r}]), kv, h${r});`);
    L.push('      }');
    for (let r = 0; r < 4; r++) L.push(`      s${r} = s${r} + vec4<f32>(h${r});`);
    L.push('    }');
  } else {
  L.push(`    for (var d = 0u; d < 128u; d = d + 1u) { let qv = vec4<f32>(qT[d * ${Q4}u + ty]); let kv = vec4<f32>(kT[d * 8u + tx]);`);
  for (let r = 0; r < 4; r++) L.push(`      s${r} = fma(vec4<f32>(qv[${r}]), kv, s${r});`);
  L.push('    }');
  }
  L.push('    let kj = k0 + tx * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  for (let r = 0; r < 4; r++) {
    L.push(`    { let qi = q0 + ty * 4u + ${r}u; var ok = kj < vec4<u32>(p.Lk);`);
    L.push(`      if (p.mode == 1u) { ok = ok & (kj <= vec4<u32>(min(qi, p.nvalid - 1u))); } if (p.mode == 2u) { ok = ok & (kj < vec4<u32>(p.nvalid)); }`);
    L.push(`      s${r} = select(vec4<f32>(-1.0e30), s${r} * p.scale, ok); }`);
  }
  if (reg) {   // m, l in registers; row max / sum over the 8 lanes of a row block via subgroup shuffles, or a 2 KB shared array
    const red = (v, op) => sg
      ? [1, 2, 4].map((k) => `${v} = ${op}(${v}, subgroupShuffleXor(${v}, ${k}u));`).join(' ')
      : null;
    for (let r = 0; r < 4; r++) L.push(`    var mx${r} = max(max(s${r}.x, s${r}.y), max(s${r}.z, s${r}.w));`);
    if (sg) for (let r = 0; r < 4; r++) L.push('    ' + red(`mx${r}`, 'max'));
    else {
      for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = mx${r};`);
      L.push('    workgroupBarrier();');
      for (let r = 0; r < 4; r++) L.push(`    for (var i = 0u; i < 8u; i = i + 1u) { mx${r} = max(mx${r}, rS[(ty * 4u + ${r}u) * 8u + i]); }`);
      L.push('    workgroupBarrier();');
    }
    for (let r = 0; r < 4; r++) {
      L.push(`    let mn${r} = max(m${r}, mx${r}); let pe${r} = select(exp2(s${r} - vec4<f32>(mn${r})), vec4<f32>(0.0), s${r} <= vec4<f32>(-1.0e29));`);
      L.push(`    var sm${r} = pe${r}.x + pe${r}.y + pe${r}.z + pe${r}.w;`);
    }
    if (sg) for (let r = 0; r < 4; r++) L.push(`    sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 1u); sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 2u); sm${r} = sm${r} + subgroupShuffleXor(sm${r}, 4u);`);
    else {
      for (let r = 0; r < 4; r++) L.push(`    rS[(ty * 4u + ${r}u) * 8u + tx] = sm${r};`);
      L.push('    workgroupBarrier();');
      for (let r = 0; r < 4; r++) L.push(`    sm${r} = 0.0; for (var i = 0u; i < 8u; i = i + 1u) { sm${r} = sm${r} + rS[(ty * 4u + ${r}u) * 8u + i]; }`);
    }
    for (let r = 0; r < 4; r++) {
      L.push(`    { let al = exp2(m${r} - mn${r}); l${r} = l${r} * al + sm${r}; m${r} = mn${r};`);
      for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = o${r}${cI} * al;`);
      for (let j = 0; j < 4; j++) L.push(`      pS[(tx * 4u + ${j}u) * ${BQ}u + ty * 4u + ${r}u] = ${pT}(pe${r}[${j}]);`);
      L.push('    }');
    }
    if (kvShared) {
      L.push('    workgroupBarrier();');
      L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { kT[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
    }
    L.push('    workgroupBarrier();');
  } else {
    for (let r = 0; r < 4; r++) for (let j = 0; j < 4; j++) L.push(`    pS[(tx * 4u + ${j}u) * ${BQ}u + ty * 4u + ${r}u] = s${r}[${j}];`);
    L.push('    workgroupBarrier();');
    L.push(`    if (li < ${BQ}u) { let mo = mS[li]; var mx = mo;`);
    L.push(`      for (var j = 0u; j < 32u; j = j + 1u) { mx = max(mx, pS[j * ${BQ}u + li]); }`);
    L.push('      var sm = 0.0;');
    L.push(`      for (var j = 0u; j < 32u; j = j + 1u) { let s = pS[j * ${BQ}u + li]; let e = select(exp2(s - mx), 0.0, s <= -1.0e29); pS[j * ${BQ}u + li] = e; sm = sm + e; }`);
    L.push('      let al = exp2(mo - mx); aS[li] = al; lS[li] = lS[li] * al + sm; mS[li] = mx; }');
    L.push('    workgroupBarrier();');
    for (let r = 0; r < 4; r++) { L.push(`    { let al = aS[ty * 4u + ${r}u];`); for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = o${r}${cI} * al;`); L.push('    }'); }
    if (kvShared) {   // v026.9: every lane finished reading K (the scores) before the first barrier: V goes into the same tile
      L.push(`    for (var t = li; t < 1024u; t = t + ${NT}u) { kT[t] = Vb[kb + min(k0 + t / 32u, p.Lk - 1u) * 32u + t % 32u]; }`);
      L.push('    workgroupBarrier();');
    }
  }
  // O += P V   (rows ty*4..+3, dims tx*16..+15)
  if (c.pv16) {   // fp16 partial sums over one 32-key tile (P in [0,1]), flushed into the fp32 accumulators per tile
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`    var h${r}${cI} = vec4<f16>(0.0);`);
    L.push('    for (var j = 0u; j < 32u; j = j + 1u) {');
    L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f16>(f16(pS[pb]), f16(pS[pb + 1u]), f16(pS[pb + 2u]), f16(pS[pb + 3u]));`);
    L.push(`      let vb = j * 32u + tx * 4u;`);
    for (let cI = 0; cI < 4; cI++) L.push(`      let v${cI} = ${VS}[vb + ${cI}u];`);
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`      h${r}${cI} = fma(vec4<f16>(pv[${r}]), v${cI}, h${r}${cI});`);
    L.push('    }');
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`    o${r}${cI} = o${r}${cI} + vec4<f32>(h${r}${cI});`);
  } else {
  L.push('    for (var j = 0u; j < 32u; j = j + 1u) {');
  L.push(`      let pb = j * ${BQ}u + ty * 4u; let pv = vec4<f32>(f32(pS[pb]), f32(pS[pb + 1u]), f32(pS[pb + 2u]), f32(pS[pb + 3u]));`);
  L.push(`      let vb = j * 32u + tx * 4u;`);
  for (let cI = 0; cI < 4; cI++) L.push(`      let v${cI} = vec4<f32>(${VS}[vb + ${cI}u]);`);
  for (let r = 0; r < 4; r++) for (let cI = 0; cI < 4; cI++) L.push(`      o${r}${cI} = fma(vec4<f32>(pv[${r}]), v${cI}, o${r}${cI});`);
  L.push('    }');
  }
  L.push('  }');
  if (!reg) L.push('  workgroupBarrier();');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / ${reg ? `l${r}` : `lS[ty * 4u + ${r}u]`};`);
    L.push(`    if (qi < p.Lq) { let ob = (qi * p.ldo + h * 128u) / 4u + tx * 4u;`);
    for (let cI = 0; cI < 4; cI++) L.push(`      Ob[ob + ${cI}u] = vec4<f16>(o${r}${cI} * inv);`);
    L.push('    } }');
  }
  L.push('}');
  return L.join('\n');
}

/** a = {q:{buf,off}, k:{buf,off}, v:{buf,off}, o:{buf,off,ld}, Lq, Lk, Hq, Hkv, mode=0, nvalid, cfg:{BQ, sg}} */
/** v026.9: the workgroup memory (bytes) a variant declares */
function attnBytes(c) {
  const BQ = c.BQ, kvs = BQ === 64 || !!c.kvs, reg = !!c.sg || BQ === 64;
  return 128 * (BQ / 4) * 8 + 1024 * 8 + (kvs ? 0 : 1024 * 8) + 32 * BQ * (BQ === 64 ? 2 : 4) + (reg ? 0 : 3 * BQ * 4) + (reg && !c.sg ? BQ * 8 * 4 : 0);
}
function attention(gpu, a) {
  const F = a.cfgF !== undefined ? a.cfgF : gpu.tune && gpu.tune.attnF;   // p0pc0rn v028: the phone-tuned kernel (attnF below)
  if (F && attnFFits(gpu, Object.assign({ D: 128 }, F))) { attnF(gpu, a, Object.assign({ D: 128, flavour: 'p', rate: gpu.rate.attn }, F)); return 4 * a.Lq * (a.Lk || a.Lq) * 128 * a.Hq; }
  let cfg = a.cfg || gpu.tune?.attn || { BQ: gpu.subgroups && gpu.sgMin >= 8 ? 64 : 32, sg: gpu.subgroups && gpu.sgMin >= 8 };
  const wgMax = (gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384;
  if (attnBytes(cfg) > wgMax) cfg = { BQ: 16, kvs: true };   // v026.9: Android-like 16 KB of workgroup memory (14.2 KB)
  const key = `attn.${cfg.BQ}.${cfg.sg ? 'sg' : ''}.${cfg.pv16 ? 'pv16' : ''}.${cfg.s16 ? 's16' : ''}${cfg.kvs ? '.kvs' : ''}`;
  const pipe = gpu.pipeline(key, () => attnCode(cfg));
  const Hq = a.Hq, Hkv = a.Hkv || a.Hq, Lq = a.Lq, Lk = a.Lk || a.Lq, ldo = a.o.ld || Hq * 128;
  const qt = Math.ceil(Lq / cfg.BQ);
  const fWG = 4 * cfg.BQ * Lk * 128, cap = gpu.cap('attn');
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  const scale = (a.scale != null ? a.scale : 1 / Math.sqrt(128)) * Math.LOG2E;
  const vw = (t, n) => ({ buffer: t.buf, offset: t.off || 0, size: t.size || n });
  const qs = Hq * Lq * 256, ks = Hkv * Lk * 256;
  const binds = [vw(a.q, qs), vw(a.k, ks), vw(a.v, ks), { buffer: a.o.buf, offset: a.o.off || 0, size: a.o.size || Math.ceil(Lq * ldo * 2 / 16) * 16 }];
  for (let h0 = 0; h0 < Hq; h0 += hPer) {
    for (let q0 = 0; q0 < qt; q0 += qPer) {
      const nh = Math.min(hPer, Hq - h0), nq = Math.min(qPer, qt - q0);
      const pr = P().u32(Lq).u32(Lk).u32(ldo).u32(Hq).u32(Hkv).f32(scale).u32(a.mode || 0).u32(a.nvalid || Lk).u32(q0).u32(h0).u32(0).u32(0);
      gpu.runner.dispatch(pipe, binds, pr.ab, [nq, nh], (fWG * nq * nh) / gpu.rate.attn);
    }
  }
  return 4 * Lq * Lk * 128 * Hq;
}

// ------------------------------------------------------------------ attnF: the phone-tuned flash attention (head_dim 128 and 256)

// p0pc0rn v028 (phone benchmark, Oct 2026): register-tiled flash attention, tuned on an iPhone 16 Pro Max (Safari 26.6.1).
// Q resident in workgroup memory, fp16 QK partials per 32-d chunk + fp16 PV partials flushed to fp32, exact online softmax, padded / interleaved
// tiles. Picture attention 464 -> 749 GFLOP/s (1.61x), video anchors 145 -> 564 GFLOP/s (3.89x); every mode (causal + valid, valid length,
// GQA, the Gemma-2 soft-cap) matches the old kernels to <= 0.15% (rel L2). Devices without 32 KB of workgroup memory keep the old kernels.
const ATTNF_P = { BQ: 64, BK: 64, TK: 4, PQ: 4, PD: 8, pv16: true, s16: true, il: true };
const ATTNF_V = { BQ: 32, BK: 128, TK: 8, PQ: 8, PD: 8, pv16: true, s16: true, il: true };
function attnFFits(gpu, c) {
  try { return attnFCfg(c).bytes <= ((gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384); } catch (e) { return false; }
}
function attnFCfg(c) {
  const D = c.D, BQ = c.BQ, BK = c.BK, TK = c.TK || 4, PQ = c.PQ || 4, PD = c.PD || 16, pv16 = !!c.pv16, kpad = c.kpad || 0, ppad = c.ppad || 0, il = !!c.il;
  const NT = (BQ / 4) * (BK / TK), NTv = (BQ / PQ) * (D / PD);
  if (NT !== NTv) throw new Error(`attnF: QK threads ${NT} != PV threads ${NTv}`);
  if (NT > 256 || TK % 4 || PD % 4) throw new Error('attnF: bad shape');
  const qV = D * BQ / 4, kChunk = 32 * (BK / 4 + kpad), pV = BK * (BQ / 4 + ppad), red = Math.max((BQ / 4) * (BK / TK) * 2, BQ);   // vec4<f16> counts (+ alpha/l rows)
  const kvBudget = 4096 - qV - pV;   // 32 KB = 4096 vec4<f16>; the KV region holds a K chunk, then the reduce, then V chunks
  let VK = c.VK || 0;
  if (!VK) { VK = 4; while (VK * 2 <= BK && VK * 2 * D / 4 <= Math.max(kvBudget, kChunk)) VK *= 2; }
  const kv = Math.max(kChunk, VK * D / 4, red);
  const bytes = (qV + kv + pV) * 8;
  if (bytes > 32768) throw new Error(`attnF: ${bytes} bytes of workgroup memory`);
  if (BK % VK) throw new Error('attnF: VK must divide BK');
  return { D, BQ, BK, TK, PQ, PD, pv16, NT, VK, qV, kv, pV, bytes, kpad, ppad, il, flavour: c.flavour || (D === 256 ? 'v' : 'p') };
}

function attnFCode(c0) {
  const c = attnFCfg(c0), { D, BQ, BK, TK, PQ, PD, pv16, NT, VK } = c, D4 = D / 4, Q4 = BQ / 4, K4 = BK / 4, TX = BK / TK, e2 = c.flavour === 'p';
  const KR = K4 + c.kpad, QR = Q4 + c.ppad;   // padded row strides (vec4) of the K chunk and of P
  const L = [], ex = (x) => e2 ? `exp2(${x})` : `exp(${x})`;
  L.push('enable f16;');
  L.push(e2 ? 'struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, p0: u32, p1: u32 };'
    : 'struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, cap: f32, p1: u32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push(`var<workgroup> qT: array<vec4<f16>, ${c.qV}>;`);
  L.push(`var<workgroup> kv: array<vec4<f16>, ${c.kv}>;`);
  L.push(`var<workgroup> pS: array<vec4<f16>, ${c.pV}>;`);
  L.push('fn rd4(i: u32) -> vec4<f32> { return vec4<f32>(bitcast<vec2<f32>>(kv[i]), bitcast<vec2<f32>>(kv[i + 1u])); }');
  L.push('fn wr4(i: u32, v: vec4<f32>) { kv[i] = bitcast<vec4<f16>>(v.xy); kv[i + 1u] = bitcast<vec4<f16>>(v.zw); }');
  L.push(`@compute @workgroup_size(${NT})`);
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push(`  let h = wid.y + p.h0; let hk = h / (p.Hq / p.Hkv); let q0 = (wid.x + p.qt0) * ${BQ}u;`);
  L.push(`  let qb = h * p.Lq * ${D4}u; let kb = hk * p.Lk * ${D4}u; let ty = li / ${TX}u; let tx = li % ${TX}u;`);
  // Q tile -> qT[d][q4], transposed through registers
  L.push(`  for (var t = li; t < ${Q4 * D4}u; t = t + ${NT}u) { let qq4 = t / ${D4}u; let d4 = t % ${D4}u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;`);
  L.push(`    let a = Qb[qb + min(qa, lq) * ${D4}u + d4]; let b = Qb[qb + min(qa + 1u, lq) * ${D4}u + d4]; let c = Qb[qb + min(qa + 2u, lq) * ${D4}u + d4]; let e = Qb[qb + min(qa + 3u, lq) * ${D4}u + d4];`);
  L.push(`    let o = d4 * ${4 * Q4}u + qq4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[o + ${j * Q4}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  L.push(`  var kEnd = p.Lk; if (p.mode == 1u) { kEnd = min(p.Lk, min(q0 + ${BQ - 1}u, p.nvalid - 1u) + 1u); } if (p.mode == 2u) { kEnd = min(p.Lk, p.nvalid); }`);
  // PV mapping
  const PG = BQ / PQ;   // query groups in PV
  L.push(`  let py = li / ${D / PD}u; let pxd = li % ${D / PD}u;   // PV: rows py*${PQ}.., dims pxd*${PD}..`);
  const PC = PD / 4;   // vec4 columns per PV thread
  for (let r = 0; r < PQ; r++) for (let cI = 0; cI < PC; cI++) L.push(`  var o${r}_${cI} = vec4<f32>(0.0);`);
  L.push('  var m = vec4<f32>(-1.0e30); var l = vec4<f32>(0.0);');   // QK rows ty*4..+3
  if (PQ !== 4) { for (let r = 0; r < PQ; r++) L.push(`  var lp${r} = 0.0;`); }
  L.push('  let qi = q0 + ty * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  L.push(`  for (var k0 = 0u; k0 < kEnd; k0 = k0 + ${BK}u) {`);
  const TKV = TK / 4;   // score vec4s per row
  for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`    var s${r}_${j} = vec4<f32>(0.0);`);
  L.push(`    for (var dc = 0u; dc < ${D}u; dc = dc + 32u) {`);
  if (c0.s16) for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`      var g${r}_${j} = vec4<f16>(0.0);`);
  L.push('      workgroupBarrier();');
  // K chunk [32 d][K4]: tasks = K4 key-quads x 8 d-quads
  L.push(`      for (var t = li; t < ${K4 * 8}u; t = t + ${NT}u) { let kk4 = t / 8u; let dq = t % 8u; let d4 = dc / 4u + dq; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;`);
  L.push(`        let a = Kb[kb + min(ka, lk) * ${D4}u + d4]; let b = Kb[kb + min(ka + 1u, lk) * ${D4}u + d4]; let c = Kb[kb + min(ka + 2u, lk) * ${D4}u + d4]; let e = Kb[kb + min(ka + 3u, lk) * ${D4}u + d4];`);
  L.push(`        let o = dq * ${4 * KR}u + kk4;`);
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`        kv[o + ${j * KR}u] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('      }');
  L.push('      workgroupBarrier();');
  L.push('      for (var d = 0u; d < 32u; d = d + 1u) {');
  if (c0.s16) {   // fp16 partial dot products over the 32-d chunk (the fp16-everywhere design)
    L.push(`        let qv = qT[(dc + d) * ${Q4}u + ty];`);
    for (let j = 0; j < TKV; j++) L.push(`        let k${j} = kv[d * ${KR}u + tx * ${TKV}u + ${j}u];`);
    for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`        g${r}_${j} = fma(vec4<f16>(qv.${'xyzw'[r]}), k${j}, g${r}_${j});`);
    L.push('      }');
    for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`      s${r}_${j} = s${r}_${j} + vec4<f32>(g${r}_${j});`);
  } else {
  L.push(`        let qv = vec4<f32>(qT[(dc + d) * ${Q4}u + ty]);`);
  for (let j = 0; j < TKV; j++) L.push(`        let k${j} = vec4<f32>(kv[d * ${KR}u + tx * ${TKV}u + ${j}u]);`);
  for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`        s${r}_${j} = fma(vec4<f32>(qv.${'xyzw'[r]}), k${j}, s${r}_${j});`);
  L.push('      }');
  }
  L.push('    }');
  // scale / cap / mask
  for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`    s${r}_${j} = s${r}_${j} * p.scale;`);
  if (!e2) { L.push('    if (p.cap > 0.0) { let cp = vec4<f32>(p.cap);'); for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`      s${r}_${j} = cp * tanh(clamp(s${r}_${j} / cp, vec4<f32>(-15.0), vec4<f32>(15.0)));`); L.push('    }'); }
  for (let j = 0; j < TKV; j++) {
    L.push(`    { let kj = k0 + tx * ${TK}u + ${j * 4}u + vec4<u32>(0u, 1u, 2u, 3u); var ok = kj < vec4<u32>(p.Lk); if (p.mode == 2u) { ok = ok & (kj < vec4<u32>(p.nvalid)); }`);
    for (let r = 0; r < 4; r++) L.push(`      { var mk = ok; if (p.mode == 1u) { mk = mk & (kj <= vec4<u32>(min(qi.${'xyzw'[r]}, p.nvalid - 1u))); } s${r}_${j} = select(vec4<f32>(-1.0e30), s${r}_${j}, mk); }`);
    L.push('    }');
  }
  const rowmax = (r) => { let e = `s${r}_0`; for (let j = 1; j < TKV; j++) e = `max(${e}, s${r}_${j})`; return `max(max((${e}).x, (${e}).y), max((${e}).z, (${e}).w))`; };
  L.push(`    let rb = ty * ${TX * 2}u;`);
  L.push('    workgroupBarrier();');
  L.push(`    wr4(rb + tx * 2u, vec4<f32>(${[0, 1, 2, 3].map(rowmax).join(', ')}));`);
  L.push('    workgroupBarrier();');
  L.push(`    var rm = rd4(rb); for (var j = 1u; j < ${TX}u; j = j + 1u) { rm = max(rm, rd4(rb + j * 2u)); }`);
  L.push(`    let mn = max(m, rm); let al = ${ex('m - mn')};`);
  for (let r = 0; r < 4; r++) for (let j = 0; j < TKV; j++) L.push(`    let e${r}_${j} = select(${ex(`s${r}_${j} - vec4<f32>(mn.${'xyzw'[r]})`)}, vec4<f32>(0.0), s${r}_${j} <= vec4<f32>(-1.0e29));`);
  for (let j = 0; j < TKV; j++) for (let k = 0; k < 4; k++) {
    const cc = 'xyzw'[k];
    L.push(`    pS[(tx * ${TK}u + ${j * 4 + k}u) * ${QR}u + ty] = vec4<f16>(vec4<f32>(e0_${j}.${cc}, e1_${j}.${cc}, e2_${j}.${cc}, e3_${j}.${cc}));`);
  }
  const rowsum = (r) => { let e = `e${r}_0`; for (let j = 1; j < TKV; j++) e += ` + e${r}_${j}`; return `dot(${e}, vec4<f32>(1.0))`; };
  L.push(`    let ls = vec4<f32>(${[0, 1, 2, 3].map(rowsum).join(', ')});`);
  L.push('    workgroupBarrier();');
  L.push('    wr4(rb + tx * 2u, ls);');
  L.push('    workgroupBarrier();');
  L.push(`    var rs = rd4(rb); for (var j = 1u; j < ${TX}u; j = j + 1u) { rs = rs + rd4(rb + j * 2u); }`);
  L.push('    l = l * al + rs; m = mn;');
  if (PQ === 4 && D / PD === TX) {   // the PV rows are the QK rows: alpha in registers
    for (let r = 0; r < 4; r++) for (let cI = 0; cI < PC; cI++) L.push(`    o${r}_${cI} = o${r}_${cI} * al.${'xyzw'[r]};`);
  } else {   // PV rows differ: alpha + l per row through shared (after the sums are read)
    L.push('    workgroupBarrier();');
    L.push(`    if (tx == 0u) { wr4(ty * 2u, al); wr4(${BQ / 4 * 2}u + ty * 2u, l); }`);
    L.push('    workgroupBarrier();');
    for (let r = 0; r < PQ; r++) {
      const row = `(py * ${PQ}u + ${r}u)`;
      L.push(`    { let ra = rd4((${row} / 4u) * 2u)[${row} % 4u]; lp${r} = rd4(${BQ / 4 * 2}u + (${row} / 4u) * 2u)[${row} % 4u];`);
      for (let cI = 0; cI < PC; cI++) L.push(`      o${r}_${cI} = o${r}_${cI} * ra;`);
      L.push('    }');
    }
  }
  L.push(`    for (var vc = 0u; vc < ${BK}u; vc = vc + ${VK}u) {`);
  L.push('      workgroupBarrier();');
  L.push(`      for (var t = li; t < ${VK * D4}u; t = t + ${NT}u) { kv[t] = Vb[kb + min(k0 + vc + t / ${D4}u, p.Lk - 1u) * ${D4}u + t % ${D4}u]; }`);
  L.push('      workgroupBarrier();');
  const PQ4 = PQ / 4;   // p vec4s per PV thread
  if (pv16) for (let r = 0; r < PQ; r++) for (let cI = 0; cI < PC; cI++) L.push(`      var h${r}_${cI} = vec4<f16>(0.0);`);
  L.push(`      for (var j = 0u; j < ${VK}u; j = j + 1u) {`);
  L.push(`        let vb = j * ${D4}u + ${c.il ? 'pxd' : `pxd * ${PC}u`};`);
  for (let q = 0; q < PQ4; q++) L.push(`        let pv${q} = ${pv16 ? '' : 'vec4<f32>('}pS[(vc + j) * ${QR}u + py * ${PQ4}u + ${q}u]${pv16 ? '' : ')'};`);
  for (let cI = 0; cI < PC; cI++) L.push(`        let v${cI} = ${pv16 ? '' : 'vec4<f32>('}kv[vb + ${c.il ? cI * (D / PD) : cI}u]${pv16 ? '' : ')'};`);
  for (let r = 0; r < PQ; r++) for (let cI = 0; cI < PC; cI++) {
    const pr = `pv${r >> 2}.${'xyzw'[r & 3]}`;
    if (pv16) L.push(`        h${r}_${cI} = fma(vec4<f16>(${pr}), v${cI}, h${r}_${cI});`);
    else L.push(`        o${r}_${cI} = fma(vec4<f32>(${pr}), v${cI}, o${r}_${cI});`);
  }
  L.push('      }');
  if (pv16) for (let r = 0; r < PQ; r++) for (let cI = 0; cI < PC; cI++) L.push(`      o${r}_${cI} = o${r}_${cI} + vec4<f32>(h${r}_${cI});`);
  L.push('    }');
  L.push('  }');
  for (let r = 0; r < PQ; r++) {
    const qrow = `(q0 + py * ${PQ}u + ${r}u)`, lv = (PQ === 4 && D / PD === TX) ? `l.${'xyzw'[r]}` : `lp${r}`;
    L.push(`  { let qr = ${qrow}; if (qr < p.Lq) { let inv = 1.0 / ${lv}; let ob = (qr * p.ldo + h * ${D}u) / 4u + ${c.il ? 'pxd' : `pxd * ${PC}u`};`);
    for (let cI = 0; cI < PC; cI++) L.push(`    Ob[ob + ${c.il ? cI * (D / PD) : cI}u] = vec4<f16>(o${r}_${cI} * inv);`);
    L.push('  } }');
  }
  L.push('}');
  return L.join('\n');
}

/** dispatch like the engine (head-major q/k/v, token-major o); flavour 'v' = attn256 params (cap, natural exp), 'p' = attention() (exp2) */
function attnF(gpu, a, c) {
  const cfg = attnFCfg(c), BQ = cfg.BQ, D = cfg.D, key = 'attnF.' + JSON.stringify(c);
  const pipe = gpu.pipeline(key, () => attnFCode(c));
  const Hq = a.Hq, Hkv = a.Hkv || Hq, Lq = a.Lq, Lk = a.Lk || Lq, ldo = a.o.ld || Hq * D, qt = Math.ceil(Lq / BQ);
  const rate = c.rate || 0.6e12, fWG = 4 * BQ * Lk * D, cap = rate * 0.2;
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  const vw = (t, n) => ({ buffer: t.buf, offset: t.off || 0, size: Math.floor(n / 16) * 16 });
  const binds = [vw(a.q, Hq * Lq * D * 2), vw(a.k, Hkv * Lk * D * 2), vw(a.v, Hkv * Lk * D * 2), { buffer: a.o.buf, offset: a.o.off || 0, size: Math.ceil(Lq * ldo * 2 / 16) * 16 }];
  const scale = cfg.flavour === 'p' ? (a.scale != null ? a.scale : 1 / Math.sqrt(D)) * Math.LOG2E : (a.scale != null ? a.scale : 1 / Math.sqrt(D));
  for (let h0 = 0; h0 < Hq; h0 += hPer) for (let q0 = 0; q0 < qt; q0 += qPer) {
    const nh = Math.min(hPer, Hq - h0), nq = Math.min(qPer, qt - q0);
    const pr = P().u32(Lq).u32(Lk).u32(ldo).u32(Hq).u32(Hkv).f32(scale).u32(a.mode || 0).u32(a.nvalid || Lk).u32(q0).u32(h0);
    if (cfg.flavour === 'p') pr.u32(0).u32(0); else pr.f32(a.cap || 0).u32(0);
    gpu.runner.dispatch(pipe, binds, pr.ab, [nq, nh], fWG * nq * nh / rate);
  }
}
return { attnCode, attention, attnBytes, attnFCfg, attnFCode, attnF, attnFFits, ATTNF_P, ATTNF_V };
})();
// ---- ops/misc.js
__M["ops/misc.js"] = (() => {
// Small kernels: row statistics (LayerNorm / RMSNorm, fp32), GroupNorm statistics (exact two-pass over the WHOLE tensor, so a
// row-banded VAE decode has no seams), elementwise ops (fp32 residual add, casts, SiLU, GELU, SwiGLU, adaLN modulate, Euler axpy),
// row softmax, f16 transpose, direct conv for tiny channel counts (VAE conv_in 3->128, conv_out 128->3).
'use strict';
const { P } = __M["core/gpu.js"];
const WG = 256;
const dummy = (g, i) => { g._dummies = g._dummies || []; return g._dummies[i] || (g._dummies[i] = g.buffer(256, 'dummy' + i)); };
const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 4) * 4 });

// ------------------------------------------------------------------ row stats: ST[(off+r)*2] = (mean, rstd)   (mode 0 LN, 1 RMS)
const ROWSTATS = `
struct P { cols: u32, ld: u32, c0: u32, mode: u32, eps: f32, off: u32, r0: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> ST: array<f32>;
var<workgroup> red: array<f32, 256>;
fn wsum(v: f32, t: u32) -> f32 {
  red[t] = v; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = red[t] + red[t + s]; } workgroupBarrier(); }
  let r = red[0]; workgroupBarrier(); return r;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let row = wid.x + wid.y * 65535u + p.r0; let base = row * p.ld + p.c0;
  var mean = 0.0;
  if (p.mode == 0u) { var s = 0.0; for (var i = t; i < p.cols; i = i + 256u) { s = s + X[base + i]; } mean = wsum(s, t) / f32(p.cols); }
  var q = 0.0; for (var i = t; i < p.cols; i = i + 256u) { let d = X[base + i] - mean; q = q + d * d; }
  let var_ = wsum(q, t) / f32(p.cols);
  if (t == 0u) { ST[(p.off + row) * 2u] = mean; ST[(p.off + row) * 2u + 1u] = inverseSqrt(var_ + p.eps); }
}`;
/** x:{buf,off(bytes),ld(floats),c0}, rows, cols, mode 'ln'|'rms', eps, st:{buf, off(rows)} */
function rowstats(gpu, a) {
  const pipe = gpu.pipeline('rowstats', () => ROWSTATS);
  for (let r0 = 0; r0 < a.rows; r0 += 65535) {
    const n = Math.min(65535, a.rows - r0);
    const pr = P().u32(a.cols).u32(a.x.ld || a.cols).u32(a.x.c0 || 0).u32(a.mode === 'rms' ? 1 : 0).f32(a.eps).u32(a.st.off || 0).u32(r0).u32(0);
    gpu.runner.dispatch(pipe, [bw(a.x.buf, a.x.off || 0), bw(a.st.buf)], pr.ab, [n, 1], (a.cols * n * 8) / gpu.rate.mem);
  }
}

// ------------------------------------------------------------------ GroupNorm statistics over an HWC f16 tensor [pix][C], 32 groups
// Exact, single pass over the tensor: each workgroup owns 64 pixels and computes per group its count, mean and M2 with an exact
// two-pass over its OWN chunk; the finaliser merges the partials with Chan's parallel formula (stable in f32).  Partials of separate
// calls merge (wgOff), so a banded / recomputed tensor gets exactly the statistics of the whole tensor (VAE band recompute at 720p).
const GN_PART = `
enable f16;
struct P { pix: u32, C: u32, wgOff: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;
@group(0) @binding(2) var<storage, read_write> PT: array<vec4<f32>>;  // [wg][32] = (n, mean, M2, 0)
var<workgroup> acc: array<f32, 512>;
var<workgroup> mg: array<f32, 32>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let wg = wid.x + wid.y * 65535u; let px0 = wg * 64u; let npx = min(64u, p.pix - min(px0, p.pix));
  let n = npx * p.C; let base = px0 * p.C; let cpg = p.C / 32u;
  var s0 = 0.0; var s1 = 0.0;
  for (var e = t; e < n; e = e + 256u) { let v = f32(X[base + e]); if (((e / 256u) & 1u) == 0u || p.C <= 256u) { s0 = s0 + v; } else { s1 = s1 + v; } }
  acc[t] = s0; acc[t + 256u] = s1; workgroupBarrier();
  let cnt = f32(npx * cpg);
  if (t < 32u) { var gs = 0.0; for (var j = 0u; j < 512u; j = j + 1u) { if ((j % p.C) / cpg == t) { gs = gs + acc[j]; } } mg[t] = gs / max(cnt, 1.0); }
  workgroupBarrier();
  s0 = 0.0; s1 = 0.0;
  for (var e = t; e < n; e = e + 256u) { let d = f32(X[base + e]) - mg[(e % p.C) / cpg]; if (((e / 256u) & 1u) == 0u || p.C <= 256u) { s0 = s0 + d * d; } else { s1 = s1 + d * d; } }
  workgroupBarrier();
  acc[t] = s0; acc[t + 256u] = s1; workgroupBarrier();
  if (t < 32u) { var m2 = 0.0; for (var j = 0u; j < 512u; j = j + 1u) { if ((j % p.C) / cpg == t) { m2 = m2 + acc[j]; } }
    PT[(p.wgOff + wg) * 32u + t] = vec4<f32>(cnt, mg[t], m2, 0.0); }
}`;
const GN_RED = `
struct P { nwg: u32, C: u32, eps: f32, off: u32, gOff: u32, bOff: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PT: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> GB: array<f32>;         // gamma at gOff, beta at bOff (floats)
@group(0) @binding(3) var<storage, read_write> AB: array<f32>;   // out: a[C], b[C] at off
@compute @workgroup_size(32)
fn main(@builtin(local_invocation_index) t: u32) {
  var n = 0.0; var mean = 0.0; var m2 = 0.0;
  for (var w = 0u; w < p.nwg; w = w + 1u) {
    let q = PT[w * 32u + t];
    if (q.x > 0.0) { let nn = n + q.x; let d = q.y - mean; mean = mean + d * (q.x / nn); m2 = m2 + q.z + d * d * (n * q.x / nn); n = nn; }
  }
  let rs = inverseSqrt(m2 / max(n, 1.0) + p.eps);
  let cpg = p.C / 32u;
  for (var c = t * cpg; c < (t + 1u) * cpg; c = c + 1u) { let a = GB[p.gOff + c] * rs; AB[p.off + c] = a; AB[p.off + p.C + c] = GB[p.bOff + c] - mean * a; }
}`;
const gnPartBytes = (pix) => Math.ceil(pix / 64) * 512;
/** partial statistics of x (HWC f16, pix x C; C a power of two 32..512) into part rows [wgOff, wgOff + ceil(pix/64)) */
function gnPartial(gpu, a) {
  const nwg = Math.ceil(a.pix / 64), wx = Math.min(nwg, 65535), wy = Math.ceil(nwg / 65535);
  gpu.runner.dispatch(gpu.pipeline('gn_part2', () => GN_PART), [bw(a.x.buf, a.x.off || 0, a.x.size), bw(a.part)], P().u32(a.pix).u32(a.C).u32(a.wgOff || 0).u32(0).ab,
    [wx, wy], a.pix * a.C * 4 / gpu.rate.mem);
  return nwg;
}
/** merge nwg partial rows -> ab = {buf, off(floats)}: a[C], b[C] with GN(x) = a*x + b per channel; gb: {buf, gOff, bOff} (bytes) */
function gnFinalize(gpu, a) {
  gpu.runner.dispatch(gpu.pipeline('gn_red2', () => GN_RED), [bw(a.part), bw(a.gb.buf), bw(a.ab.buf)],
    P().u32(a.nwg).u32(a.C).f32(a.eps || 1e-6).u32(a.ab.off || 0).u32(a.gb.gOff / 4).u32(a.gb.bOff / 4).u32(0).u32(0).ab, [1, 1], a.nwg * 64 / gpu.rate.mem + 1e-3);
}
/** Exact GroupNorm(32) statistics of x -> ab.  part: scratch >= gnPartBytes(pix).  (a.ms is accepted and unused.) */
function groupnormStats(gpu, a) {
  const nwg = gnPartial(gpu, { x: a.x, pix: a.pix, C: a.C, part: a.part });
  gnFinalize(gpu, { part: a.part, nwg, C: a.C, gb: a.gb, ab: a.ab, eps: a.eps });
}

// ------------------------------------------------------------------ elementwise
const EW = `
enable f16;
struct P { n: u32, cols: u32, op: u32, aOff: u32, bOff: u32, vOff: u32, v2Off: u32, alpha: f32, ldo: u32, cOff: u32, half: u32, gate: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> A: array<f32>;
@group(0) @binding(2) var<storage, read_write> B: array<f16>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
fn silu(x: f32) -> f32 { return x / (1.0 + exp(-x)); }
fn gelu(x: f32) -> f32 { let u = 0.7978845608 * (x + 0.044715 * x * x * x); return 0.5 * x * (1.0 + tanh(clamp(u, -15.0, 15.0))); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    let col = i % p.cols;
    switch p.op {
      case 0u: { var g = 1.0; if (p.gate == 1u) { g = V[p.vOff + col]; } A[p.aOff + i] = A[p.aOff + i] + g * f32(B[p.bOff + i]); }      // fp32 residual += gate * x16
      case 1u: { A[p.aOff + i] = f32(B[p.bOff + i]); }                                                                             // cast 16 -> 32
      case 2u: { B[p.bOff + i] = f16(A[p.aOff + i]); }                                                                             // cast 32 -> 16
      case 3u: { B[p.bOff + i] = f16(silu(f32(B[p.bOff + i]))); }                                                                  // SiLU in place
      case 4u: { B[p.bOff + i] = f16(gelu(f32(B[p.bOff + i]))); }                                                                  // GELU (tanh) in place
      case 5u: { B[p.bOff + i] = f16(A[p.aOff + i] * (1.0 + V[p.vOff + col]) + V[p.v2Off + col]); }                                 // adaLN modulate
      case 6u: { A[p.aOff + i] = A[p.aOff + i] + p.alpha * V[p.vOff + i]; }                                                        // axpy (Euler step)
      case 7u: { let r = i / p.cols; B[p.cOff + r * p.ldo + col] = f16(silu(f32(B[p.bOff + r * 2u * p.half + col])) * f32(B[p.bOff + r * 2u * p.half + p.half + col])); } // SwiGLU rows [gate|up] -> out (cols = half)
      default: {}
    }
  }
}`;
const OPS = { resadd: 0, cast16to32: 1, cast32to16: 2, silu: 3, gelu: 4, modulate: 5, axpy: 6, swiglu: 7 };
/** a = {op, n, cols, A:{buf,off(floats)}, B:{buf,off(halves)}, V:{buf}, vOff, v2Off, alpha, gate, swiglu: {half, ldo, cOff}} */
function ew(gpu, a) {
  const pipe = gpu.pipeline('ew', () => EW);
  const A = a.A ? a.A.buf : dummy(gpu, 0), B = a.B ? a.B.buf : dummy(gpu, 1), V = a.V ? a.V.buf : dummy(gpu, 2);
  const s = a.swiglu || {};
  const pr = P().u32(a.n).u32(a.cols || a.n).u32(OPS[a.op]).u32(a.A ? a.A.off || 0 : 0).u32(a.B ? a.B.off || 0 : 0).u32(a.vOff || 0).u32(a.v2Off || 0)
    .f32(a.alpha || 0).u32(s.ldo || 0).u32(s.cOff || 0).u32(s.half || 0).u32(a.gate ? 1 : 0);
  gpu.runner.dispatch(pipe, [bw(A), bw(B), bw(V)], pr.ab, [Math.min(65535, Math.ceil(a.n / 256)), 1], a.n * 8 / gpu.rate.mem);
}

// ------------------------------------------------------------------ row softmax: S f32 [rows][ld] (n valid columns, scaled) -> P f16 [rows][ld]
const SOFTMAX = `
enable f16;
struct P { n: u32, scale: f32, r0: u32, ld: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read_write> O: array<f16>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let base = (wid.x + p.r0) * p.ld;
  var m = -3.0e38; for (var i = t; i < p.n; i = i + 256u) { m = max(m, S[base + i] * p.scale); }
  red[t] = m; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = max(red[t], red[t + s]); } workgroupBarrier(); }
  m = red[0]; workgroupBarrier();
  var z = 0.0; for (var i = t; i < p.n; i = i + 256u) { z = z + exp(S[base + i] * p.scale - m); }
  red[t] = z; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { red[t] = red[t] + red[t + s]; } workgroupBarrier(); }
  let inv = 1.0 / red[0];
  for (var i = t; i < p.n; i = i + 256u) { O[base + i] = f16(exp(S[base + i] * p.scale - m) * inv); }
}`;
function softmax(gpu, a) {
  const pipe = gpu.pipeline('softmax2', () => SOFTMAX), ld = a.ld || a.n;
  for (let r0 = 0; r0 < a.rows; r0 += 65535) {
    const n = Math.min(65535, a.rows - r0);
    gpu.runner.dispatch(pipe, [bw(a.s.buf, a.s.off || 0), bw(a.o.buf, a.o.off || 0)], P().u32(a.n).f32(a.scale || 1).u32(r0).u32(ld).ab, [n, 1], n * a.n * 12 / gpu.rate.mem);
  }
}

// ------------------------------------------------------------------ transpose f16 [R][C] -> [C][R]
const TRANSPOSE = `
enable f16;
struct P { R: u32, C: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;
@group(0) @binding(2) var<storage, read_write> Y: array<f16>;
var<workgroup> tl: array<f16, 272>;
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
  let r = wid.y * 16u + l.y; let c = wid.x * 16u + l.x;
  if (r < p.R && c < p.C) { tl[l.y * 17u + l.x] = X[r * p.C + c]; }
  workgroupBarrier();
  let r2 = wid.y * 16u + l.x; let c2 = wid.x * 16u + l.y;
  if (r2 < p.R && c2 < p.C) { Y[c2 * p.R + r2] = tl[l.x * 17u + l.y]; }
}`;
function transpose16(gpu, a) {
  const pipe = gpu.pipeline('transpose16', () => TRANSPOSE);
  gpu.runner.dispatch(pipe, [bw(a.x.buf, a.x.off || 0), bw(a.y.buf, a.y.off || 0)], P().u32(a.R).u32(a.C).u32(0).u32(0).ab,
    [Math.ceil(a.C / 16), Math.ceil(a.R / 16)], a.R * a.C * 4 / gpu.rate.mem);
}

// ------------------------------------------------------------------ direct conv (tiny Cin or Cout): HWC f16 in, OHWI f16 weights, f32 bias
const CONVD = `
enable f16;
struct P { Hi: u32, Wi: u32, Ci: u32, Ho: u32, Wo: u32, Co: u32, ks: u32, stride: u32, padT: u32, padL: u32, gn: u32, out32: u32, wOff: u32, bOff: u32, abOff: u32, i0: u32, n: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;
@group(0) @binding(2) var<storage, read> W: array<f16>;
@group(0) @binding(3) var<storage, read> F: array<f32>;           // bias at bOff (floats)
@group(0) @binding(4) var<storage, read> G: array<f32>;           // GN a/b at abOff (floats)
@group(0) @binding(5) var<storage, read_write> Y: array<f16>;
@group(0) @binding(6) var<storage, read_write> Y32: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = p.i0 + gid.x + gid.y * 65535u * 64u; if (idx >= p.n) { return; }
  let co = idx % p.Co; let px = idx / p.Co; let oy = px / p.Wo; let ox = px % p.Wo;
  var s = F[p.bOff + co];
  for (var ky = 0u; ky < p.ks; ky = ky + 1u) { for (var kx = 0u; kx < p.ks; kx = kx + 1u) {
    let iy = i32(oy * p.stride + ky) - i32(p.padT); let ix = i32(ox * p.stride + kx) - i32(p.padL);
    if (iy < 0 || ix < 0 || iy >= i32(p.Hi) || ix >= i32(p.Wi)) { continue; }
    let xb = (u32(iy) * p.Wi + u32(ix)) * p.Ci; let wb = p.wOff + ((co * p.ks + ky) * p.ks + kx) * p.Ci;
    for (var c = 0u; c < p.Ci; c = c + 1u) {
      var v = f32(X[xb + c]);
      if (p.gn == 1u) { let z = v * G[p.abOff + c] + G[p.abOff + p.Ci + c]; v = z / (1.0 + exp(-z)); }
      s = s + v * f32(W[wb + c]);
    } } }
  if (p.out32 == 1u) { Y32[idx] = s; } else { Y[idx] = f16(s); }
}`;
/** conv for Cin=3 or Cout=3.  w:{buf,off(bytes)} OHWI f16; f:{buf} f32 holding the bias (bOff floats); g:{buf} GN a,b (abOff floats).
 *  Split into dispatches under the time cap (this kernel runs at roughly 10 % of the GEMM rate). */
function convDirect(gpu, a) {
  const pipe = gpu.pipeline('convd2', () => CONVD);
  const n = a.Ho * a.Wo * a.Co, per = 2 * a.ks * a.ks * a.Ci, rate = (gpu.rate.mm32 || gpu.rate.mm) * 0.1;
  const chunk = Math.max(64 * 64, Math.floor(rate * gpu.opts.maxDispatchSeconds / per / 64) * 64);
  const yb = a.out32 ? dummy(gpu, 1) : a.y.buf, y32 = a.out32 ? a.y.buf : dummy(gpu, 2);
  const binds = [bw(a.x.buf, a.x.off || 0), bw(a.w.buf), bw(a.f.buf), bw(a.g ? a.g.buf : dummy(gpu, 0)), bw(yb, a.out32 ? 0 : (a.y.off || 0)), bw(y32, a.out32 ? (a.y.off || 0) : 0)];
  for (let i0 = 0; i0 < n; i0 += chunk) {
    const m = Math.min(chunk, n - i0), wgs = Math.ceil(m / 64);
    const pr = P().u32(a.Hi).u32(a.Wi).u32(a.Ci).u32(a.Ho).u32(a.Wo).u32(a.Co).u32(a.ks).u32(a.stride || 1).u32(a.padT || 0).u32(a.padL || 0)
      .u32(a.gn ? 1 : 0).u32(a.out32 ? 1 : 0).u32((a.w.off || 0) / 2).u32(a.bOff || 0).u32(a.abOff || 0).u32(i0).u32(i0 + m);
    gpu.runner.dispatch(pipe, binds, pr.ab, [Math.min(wgs, 65535), Math.ceil(wgs / 65535)], m * per / rate);
  }
}

// ------------------------------------------------------------------ small layout kernels (text encoder taps, VAE in/out, RGBA8)
const LAYOUT = `
enable f16;
struct P { op: u32, n: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> XF: array<f32>;
@group(0) @binding(2) var<storage, read> XH: array<f16>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read_write> YF: array<f32>;
@group(0) @binding(5) var<storage, read_write> YH: array<f16>;
@group(0) @binding(6) var<storage, read_write> YU: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    switch p.op {
      case 0u: {   // cast2d: YH[r*ldy + y0 + c] = f16(XF[r*ldx + x0 + c])      a=cols b=ldx c=x0 d=ldy e=y0
        let r = i / p.a; let c = i % p.a; YH[r * p.d + p.e + c] = f16(XF[r * p.b + p.c + c]); }
      case 1u: {   // chanAffine (GroupNorm apply, no activation): YH[i] = f16(XH[i] * V[f + ch] + V[f + C + ch])   a=C f=abOff
        let ch = i % p.a; YH[i] = f16(f32(XH[i]) * V[p.f + ch] + V[p.f + p.a + ch]); }
      case 2u: {   // vae_in: tokens f32 [h*w][128] -> BN^-1 -> unpatchify -> HWC f16 [(2h)(2w)][32]     a=w c=meanOff d=varOff
        let ch32 = i % 32u; let px = i / 32u; let W2 = 2u * p.a; let Y = px / W2; let X = px % W2;
        let ch = ch32 * 4u + (Y & 1u) * 2u + (X & 1u); let t = (Y >> 1u) * p.a + (X >> 1u);
        YH[i] = f16(XF[t * 128u + ch] * sqrt(V[p.d + ch] + 1.0e-4) + V[p.c + ch]); }
      case 3u: {   // vae_out: HWC f16 [(2h)(2w)][ldc] (channels 0..31) -> patchify -> BN -> tokens f32 [h*w][128]   a=w b=ldc c=meanOff d=varOff
        let ch = i % 128u; let t = i / 128u; let ii = t / p.a; let jj = t % p.a; let c = ch / 4u; let pi = (ch / 2u) & 1u; let pj = ch & 1u;
        let src = ((2u * ii + pi) * (2u * p.a) + 2u * jj + pj) * p.b + c;
        YF[i] = (f32(XH[src]) - V[p.c + ch]) / sqrt(V[p.d + ch] + 1.0e-4); }
      case 4u: {   // rgba8: f32 [pix][3] -> u32 RGBA, the reference implementation's image-save rule floor(255 * clamp((x + 1) / 2, 0, 1))
        let r = u32(floor(255.0 * clamp((XF[i * 3u] + 1.0) / 2.0, 0.0, 1.0)));
        let g = u32(floor(255.0 * clamp((XF[i * 3u + 1u] + 1.0) / 2.0, 0.0, 1.0)));
        let b = u32(floor(255.0 * clamp((XF[i * 3u + 2u] + 1.0) / 2.0, 0.0, 1.0)));
        YU[i] = r | (g << 8u) | (b << 16u) | (255u << 24u); }
      case 5u: {   // f32 -> f16 copy (img_in input tokens)
        YH[i] = f16(XF[i]); }
      default: {}
    }
  }
}`;
const LOPS = { cast2d: 0, chanAffine: 1, vaeIn: 2, vaeOut: 3, rgba8: 4, cast16: 5 };
/** a = {op, n, xf, xh, v, yf, yh, yu: {buf, off(bytes), size?}, a..f: u32 params} */
function layout(gpu, a) {
  const pipe = gpu.pipeline('layout', () => LAYOUT);
  const b = (t, i) => (t ? bw(t.buf, t.off || 0, t.size) : bw(dummy(gpu, i)));
  gpu.runner.dispatch(pipe, [b(a.xf, 0), b(a.xh, 1), b(a.v, 2), b(a.yf, 3), b(a.yh, 4), b(a.yu, 5)],
    P().u32(LOPS[a.op]).u32(a.n).u32(a.a || 0).u32(a.b || 0).u32(a.c || 0).u32(a.d || 0).u32(a.e || 0).u32(a.f || 0).ab,
    [Math.min(Math.ceil(a.n / 256), 8192), 1], a.n * 8 / gpu.rate.mem);
}

return { rowstats, gnPartBytes, gnPartial, gnFinalize, groupnormStats, ew, softmax, transpose16, convDirect, layout };
})();
// ---- ops/video.js
__M["ops/video.js"] = (() => {
// Video-model kernels (SANA-Video 2.0 DiT, Gemma-2 TE, LTX-2.3 VAE) on top of the Pocket Flux core.
//   laprep    : gated-linear-attention prep: q/k RMSNorm over the FULL hidden dim (2560), weights, RoPE (interleaved pairs),
//               k *= sigmoid(beta), head-major Q/K/V write (u32-packed stores only).
//   kvstate   : per head KV = sum_n V[n] (x) K'[n]  (128 x 128, fp32 accumulators), token range split across workgroups
//   kvreduce  : sum of the splits * (1/N) -> fp16 KV (the o_norm after the read-out makes the 1/N scale exact-neutral)
//   attn256   : flash attention for head_dim 256 (SANA anchors 10x256, Gemma-2 8x256 GQA), masks none / causal+valid /
//               valid-length, optional logit soft-cap (Gemma-2: 50), fp32 scores + softmax stats
//   attnres   : SANA "Attention Residual" depth aggregation: softmax over sources of q . rms(src), weighted sum (fp32 out)
//   pixstats  : LTX PixelNorm rstd per voxel over channels (fp16 THWC in)
//   d2s       : LTX depth-to-space (c p1 p2 p3) -> (t p1, h p2, w p3), first p1-1 frames dropped; u32 (2-channel) stores
// Rule (Metal): never store a single component of a shared-memory vector; transpose in registers.
'use strict';
const { P } = __M["core/gpu.js"];
const { attnF, attnFFits } = __M["ops/attention.js"];   // p0pc0rn v028
const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 });

// ------------------------------------------------------------------ laprep
const LAPREP = `
enable f16;
struct P { N: u32, D: u32, H: u32, ldqkv: u32, ldg: u32, gOff: u32, eps: f32, r0: u32, hp: u32, beta: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> QKV: array<u32>;        // [N][ldqkv] f16 (q | k | v), read as u32 pairs
@group(0) @binding(2) var<storage, read> G: array<f16>;          // gate/beta GEMM output [N][ldg]; beta logits at gOff + h
@group(0) @binding(3) var<storage, read> W: array<f32>;          // q_norm weight [D] | k_norm weight [D]
@group(0) @binding(4) var<storage, read> RP: array<f32>;         // rope [N][hp][cos, sin]  (hp = head_dim / 2 pairs per head)
@group(0) @binding(5) var<storage, read_write> O: array<u32>;    // Q | K | V head-major [3][H][N][128] f16 (u32 pairs)
var<workgroup> rq: array<f32, 256>; var<workgroup> rk: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let n = wid.x + wid.y * 65535u + p.r0; if (n >= p.N) { return; }
  let pairs = p.D / 2u; let rb = n * (p.ldqkv / 2u);
  var sq = 0.0; var sk = 0.0;
  for (var i = t; i < pairs; i = i + 256u) { let a = unpack2x16float(QKV[rb + i]); let b = unpack2x16float(QKV[rb + pairs + i]); sq = sq + dot(a, a); sk = sk + dot(b, b); }
  rq[t] = sq; rk[t] = sk; workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { rq[t] = rq[t] + rq[t + s]; rk[t] = rk[t] + rk[t + s]; } workgroupBarrier(); }
  let iq = inverseSqrt(rq[0] / f32(p.D) + p.eps); let ik = inverseSqrt(rk[0] / f32(p.D) + p.eps);
  let sec = p.H * p.N * p.hp;                                     // u32 words per section
  for (var i = t; i < pairs; i = i + 256u) {
    let h = i / p.hp; let pp = i % p.hp; let c = 2u * i;
    let cs = RP[(n * p.hp + pp) * 2u]; let sn = RP[(n * p.hp + pp) * 2u + 1u];
    let q = unpack2x16float(QKV[rb + i]) * iq * vec2<f32>(W[c], W[c + 1u]);
    let k = unpack2x16float(QKV[rb + pairs + i]) * ik * vec2<f32>(W[p.D + c], W[p.D + c + 1u]);
    var beta = 1.0; if (p.beta == 1u) { beta = 1.0 / (1.0 + exp(-f32(G[n * p.ldg + p.gOff + h]))); }
    let o = (h * p.N + n) * p.hp + pp;
    O[o] = pack2x16float(vec2<f32>(q.x * cs - q.y * sn, q.x * sn + q.y * cs));
    O[sec + o] = pack2x16float(vec2<f32>(k.x * cs - k.y * sn, k.x * sn + k.y * cs) * beta);
    O[2u * sec + o] = QKV[rb + 2u * pairs + i];
  }
}`;
/** qkv:{buf} f16 [N][3D]; g:{buf, ld, off} gate/beta GEMM output (f16) with beta logits at column off+h; w: f32 [2D] (q_norm|k_norm);
 *  rope f32 [N][64][2]; out: head-major Q|K|V [3][H][N][128] f16 */
function laprep(gpu, a) {
  const pipe = gpu.pipeline('laprep', () => LAPREP);
  for (let r0 = 0; r0 < a.N; r0 += 65535 * 64) {
    const n = Math.min(65535 * 64, a.N - r0), wx = Math.min(n, 65535), wy = Math.ceil(n / 65535);
    gpu.runner.dispatch(pipe, [bw(a.qkv.buf), bw(a.g ? a.g.buf : a.qkv.buf), bw(a.w.buf, a.w.off || 0), bw(a.rope.buf), bw(a.out.buf)],
      P().u32(a.N).u32(a.D).u32(a.D / (a.hd || 128)).u32(a.qkv.ld || 3 * a.D).u32(a.g ? a.g.ld : 0).u32(a.g ? a.g.off : 0).f32(a.eps || 1e-5).u32(r0)
        .u32((a.hd || 128) / 2).u32(a.g ? 1 : 0).u32(0).u32(0).ab, [wx, wy], n * a.D * 12 / gpu.rate.mem);
  }
}

// ------------------------------------------------------------------ kvstate + kvreduce
const KVSTATE = `
enable f16;
struct P { N: u32, H: u32, per: u32, S: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> QKV: array<vec4<f16>>;    // head-major sections; K at section 1, V at section 2
@group(0) @binding(2) var<storage, read_write> PT: array<vec4<f32>>; // partial [S][H][128 dv][128 dk]
var<workgroup> ks: array<vec4<f16>, 512>; var<workgroup> vs: array<vec4<f16>, 512>;   // [16 tokens][32 vec4]
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let s = wid.x; let h = wid.y; let tx = li % 16u; let ty = li / 16u;
  let sec = p.H * p.N * 32u; let kb = sec + h * p.N * 32u; let vb = 2u * sec + h * p.N * 32u;
  let n0 = s * p.per; let n1 = min(p.N, n0 + p.per);
${[0, 1, 2, 3, 4, 5, 6, 7].map((r) => `  var a${r}0 = vec4<f32>(0.0); var a${r}1 = vec4<f32>(0.0);`).join('\n')}
  for (var c = n0; c < n1; c = c + 16u) {
    for (var i = li; i < 512u; i = i + 256u) { let tk = c + i / 32u; let ok = tk < n1; let src = min(tk, p.N - 1u) * 32u + i % 32u;
      ks[i] = select(vec4<f16>(0.0), QKV[kb + src], ok); vs[i] = select(vec4<f16>(0.0), QKV[vb + src], ok); }
    workgroupBarrier();
    for (var j = 0u; j < 16u; j = j + 1u) {
      let v0 = vec4<f32>(vs[j * 32u + ty * 2u]); let v1 = vec4<f32>(vs[j * 32u + ty * 2u + 1u]);
      let k0 = vec4<f32>(ks[j * 32u + tx * 2u]); let k1 = vec4<f32>(ks[j * 32u + tx * 2u + 1u]);
${[0, 1, 2, 3, 4, 5, 6, 7].map((r) => `      a${r}0 = fma(vec4<f32>(v${r >> 2}[${r & 3}]), k0, a${r}0); a${r}1 = fma(vec4<f32>(v${r >> 2}[${r & 3}]), k1, a${r}1);`).join('\n')}
    }
    workgroupBarrier();
  }
  let ob = ((s * p.H + h) * 128u + ty * 8u) * 32u + tx * 2u;
${[0, 1, 2, 3, 4, 5, 6, 7].map((r) => `  PT[ob + ${r * 32}u] = a${r}0; PT[ob + ${r * 32 + 1}u] = a${r}1;`).join('\n')}
}`;
const KVRED = `
enable f16;
struct P { H: u32, S: u32, scale: f32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> PT: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> KV: array<vec2<u32>>;  // f16 [H][128][128] as 4-half packs
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = g.x; let n = p.H * 4096u; if (i >= n) { return; }
  var a = vec4<f32>(0.0);
  for (var s = 0u; s < p.S; s = s + 1u) { a = a + PT[s * n + i]; }
  a = a * p.scale;
  KV[i] = vec2<u32>(pack2x16float(a.xy), pack2x16float(a.zw));
}`;
/** qkvh: head-major Q|K|V buffer (laprep output); kv: f16 [H][128 dv][128 dk] out; part: scratch >= S*H*65536 B */
function kvstate(gpu, a) {
  const S = a.splits || Math.max(1, Math.min(64, Math.ceil(a.N / 512))), per = Math.ceil(a.N / S / 16) * 16;
  const p1 = gpu.pipeline('kvstate', () => KVSTATE), p2 = gpu.pipeline('kvreduce', () => KVRED);
  gpu.runner.dispatch(p1, [bw(a.qkvh.buf), bw(a.part)], P().u32(a.N).u32(a.H).u32(per).u32(S).ab, [S, a.H], 2 * a.N * 16384 * a.H / gpu.rate.mm);
  gpu.runner.dispatch(p2, [bw(a.part), bw(a.kv.buf)], P().u32(a.H).u32(S).f32(1 / a.N).u32(0).ab, [Math.ceil(a.H * 4096 / 256), 1], a.H * 65536 * S / gpu.rate.mem);
  return 2 * a.N * 16384 * a.H;
}

// ------------------------------------------------------------------ attn256: flash attention, head_dim 256 (portable, no subgroups)
function attn256Code() {
  const L = [];
  L.push('enable f16;');
  L.push('struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, cap: f32, p1: u32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push('var<workgroup> qT: array<vec4<f16>, 1024>;');    // [256 d][4]  (16 queries)
  L.push('var<workgroup> kT: array<vec4<f16>, 1024>;');    // [256 d][4]  (16 keys)
  L.push('var<workgroup> vS: array<vec4<f16>, 1024>;');    // [16 keys][64]
  L.push('var<workgroup> pS: array<f32, 256>;');           // [16 keys][16 q]
  L.push('var<workgroup> mS: array<f32, 16>; var<workgroup> lS: array<f32, 16>; var<workgroup> aS: array<f32, 16>;');
  L.push('@compute @workgroup_size(64)');
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push('  let h = wid.y + p.h0; let hk = h / (p.Hq / p.Hkv); let q0 = (wid.x + p.qt0) * 16u;');
  L.push('  let qb = h * p.Lq * 64u; let kb = hk * p.Lk * 64u; let ty = li / 16u; let tx = li % 16u;');
  L.push('  for (var t = li; t < 256u; t = t + 64u) { let qq4 = t / 64u; let d4 = t % 64u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;');
  L.push('    let a = Qb[qb + min(qa, lq) * 64u + d4]; let b = Qb[qb + min(qa + 1u, lq) * 64u + d4]; let c = Qb[qb + min(qa + 2u, lq) * 64u + d4]; let e = Qb[qb + min(qa + 3u, lq) * 64u + d4];');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`    qT[(d4 * 4u + ${j}u) * 4u + qq4] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('  }');
  L.push('  var kEnd = p.Lk; if (p.mode == 1u) { kEnd = min(p.Lk, min(q0 + 15u, p.nvalid - 1u) + 1u); } if (p.mode == 2u) { kEnd = min(p.Lk, p.nvalid); }');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) L.push(`  var o${r}${c} = vec4<f32>(0.0);`);
  L.push('  if (li < 16u) { mS[li] = -1.0e30; lS[li] = 0.0; }');
  L.push('  for (var k0 = 0u; k0 < kEnd; k0 = k0 + 16u) {');
  L.push('    workgroupBarrier();');
  L.push('    for (var t = li; t < 256u; t = t + 64u) { let kk4 = t / 64u; let d4 = t % 64u; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;');
  L.push('      let a = Kb[kb + min(ka, lk) * 64u + d4]; let b = Kb[kb + min(ka + 1u, lk) * 64u + d4]; let c = Kb[kb + min(ka + 2u, lk) * 64u + d4]; let e = Kb[kb + min(ka + 3u, lk) * 64u + d4];');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`      kT[(d4 * 4u + ${j}u) * 4u + kk4] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('    }');
  L.push('    for (var t = li; t < 1024u; t = t + 64u) { vS[t] = Vb[kb + min(k0 + t / 64u, p.Lk - 1u) * 64u + t % 64u]; }');
  L.push('    workgroupBarrier();');
  L.push('    var s = vec4<f32>(0.0); let kq = tx / 4u; let kc = tx % 4u;');
  L.push('    for (var d = 0u; d < 256u; d = d + 1u) { s = fma(vec4<f32>(qT[d * 4u + ty]), vec4<f32>(f32(kT[d * 4u + kq][kc])), s); }');
  L.push('    s = s * p.scale; if (p.cap > 0.0) { s = p.cap * tanh(clamp(s / p.cap, vec4<f32>(-15.0), vec4<f32>(15.0))); }');
  L.push('    let kj = k0 + tx; let qi = q0 + ty * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  L.push('    var ok = vec4<bool>(kj < p.Lk);');
  L.push('    if (p.mode == 1u) { ok = ok & (vec4<u32>(kj) <= min(qi, vec4<u32>(p.nvalid - 1u))); } if (p.mode == 2u) { ok = ok & vec4<bool>(kj < p.nvalid); }');
  L.push('    s = select(vec4<f32>(-1.0e30), s, ok);');
  for (let r = 0; r < 4; r++) L.push(`    pS[tx * 16u + ty * 4u + ${r}u] = s[${r}];`);
  L.push('    workgroupBarrier();');
  L.push('    if (li < 16u) { let mo = mS[li]; var mx = mo; for (var j = 0u; j < 16u; j = j + 1u) { mx = max(mx, pS[j * 16u + li]); }');
  L.push('      var sm = 0.0; for (var j = 0u; j < 16u; j = j + 1u) { let v = pS[j * 16u + li]; let e = select(exp(v - mx), 0.0, v <= -1.0e29); pS[j * 16u + li] = e; sm = sm + e; }');
  L.push('      let al = exp(mo - mx); aS[li] = al; lS[li] = lS[li] * al + sm; mS[li] = mx; }');
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) { L.push(`    { let al = aS[ty * 4u + ${r}u];`); for (let c = 0; c < 4; c++) L.push(`      o${r}${c} = o${r}${c} * al;`); L.push('    }'); }
  L.push('    for (var j = 0u; j < 16u; j = j + 1u) { let pb = j * 16u + ty * 4u; let pv = vec4<f32>(pS[pb], pS[pb + 1u], pS[pb + 2u], pS[pb + 3u]); let vb = j * 64u + tx * 4u;');
  for (let c = 0; c < 4; c++) L.push(`      let v${c} = vec4<f32>(vS[vb + ${c}u]);`);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) L.push(`      o${r}${c} = fma(vec4<f32>(pv[${r}]), v${c}, o${r}${c});`);
  L.push('    }');
  L.push('  }');
  L.push('  workgroupBarrier();');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / lS[ty * 4u + ${r}u]; if (qi < p.Lq) { let ob = (qi * p.ldo + h * 256u) / 4u + tx * 4u;`);
    for (let c = 0; c < 4; c++) L.push(`    Ob[ob + ${c}u] = vec4<f16>(o${r}${c} * inv);`);
    L.push('  } }');
  }
  L.push('}');
  return L.join('\n');
}
/** p0pc0rn v026.9: attn256 in 9.2 KB of workgroup memory (16 KB devices): Q and K one 128-dim half at a time, then V in the same tile */
function attn256SplitCode() {
  const L = [];
  L.push('enable f16;');
  L.push('struct P { Lq: u32, Lk: u32, ldo: u32, Hq: u32, Hkv: u32, scale: f32, mode: u32, nvalid: u32, qt0: u32, h0: u32, cap: f32, p1: u32 };');
  L.push('@group(0) @binding(0) var<uniform> p: P;');
  L.push('@group(0) @binding(1) var<storage, read> Qb: array<vec4<f16>>;');
  L.push('@group(0) @binding(2) var<storage, read> Kb: array<vec4<f16>>;');
  L.push('@group(0) @binding(3) var<storage, read> Vb: array<vec4<f16>>;');
  L.push('@group(0) @binding(4) var<storage, read_write> Ob: array<vec4<f16>>;');
  L.push('var<workgroup> sh: array<vec4<f16>, 1024>;');   // [0, 512): Q half [128 d][4] ; [512, 1024): K half [128 d][4] ; then V [16 keys][64]
  L.push('var<workgroup> pS: array<f32, 256>;');
  L.push('var<workgroup> mS: array<f32, 16>; var<workgroup> lS: array<f32, 16>; var<workgroup> aS: array<f32, 16>;');
  L.push('@compute @workgroup_size(64)');
  L.push('fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {');
  L.push('  let h = wid.y + p.h0; let hk = h / (p.Hq / p.Hkv); let q0 = (wid.x + p.qt0) * 16u;');
  L.push('  let qb = h * p.Lq * 64u; let kb = hk * p.Lk * 64u; let ty = li / 16u; let tx = li % 16u;');
  L.push('  var kEnd = p.Lk; if (p.mode == 1u) { kEnd = min(p.Lk, min(q0 + 15u, p.nvalid - 1u) + 1u); } if (p.mode == 2u) { kEnd = min(p.Lk, p.nvalid); }');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) L.push(`  var o${r}${c} = vec4<f32>(0.0);`);
  L.push('  if (li < 16u) { mS[li] = -1.0e30; lS[li] = 0.0; }');
  L.push('  for (var k0 = 0u; k0 < kEnd; k0 = k0 + 16u) {');
  L.push('    var s = vec4<f32>(0.0); let kq = tx / 4u; let kc = tx % 4u;');
  L.push('    for (var hf = 0u; hf < 2u; hf = hf + 1u) {');
  L.push('      workgroupBarrier();');
  L.push('      for (var t = li; t < 128u; t = t + 64u) { let qq4 = t / 32u; let d4 = hf * 32u + t % 32u; let qa = q0 + qq4 * 4u; let lq = p.Lq - 1u;');
  L.push('        let a = Qb[qb + min(qa, lq) * 64u + d4]; let b = Qb[qb + min(qa + 1u, lq) * 64u + d4]; let c = Qb[qb + min(qa + 2u, lq) * 64u + d4]; let e = Qb[qb + min(qa + 3u, lq) * 64u + d4];');
  L.push('        let dl = d4 - hf * 32u;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`        sh[(dl * 4u + ${j}u) * 4u + qq4] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('      }');
  L.push('      for (var t = li; t < 128u; t = t + 64u) { let kk4 = t / 32u; let d4 = hf * 32u + t % 32u; let ka = k0 + kk4 * 4u; let lk = p.Lk - 1u;');
  L.push('        let a = Kb[kb + min(ka, lk) * 64u + d4]; let b = Kb[kb + min(ka + 1u, lk) * 64u + d4]; let c = Kb[kb + min(ka + 2u, lk) * 64u + d4]; let e = Kb[kb + min(ka + 3u, lk) * 64u + d4];');
  L.push('        let dl = d4 - hf * 32u;');
  ['x', 'y', 'z', 'w'].forEach((cc, j) => L.push(`        sh[512u + (dl * 4u + ${j}u) * 4u + kk4] = vec4<f16>(a.${cc}, b.${cc}, c.${cc}, e.${cc});`));
  L.push('      }');
  L.push('      workgroupBarrier();');
  L.push('      for (var d = 0u; d < 128u; d = d + 1u) { s = fma(vec4<f32>(sh[d * 4u + ty]), vec4<f32>(f32(sh[512u + d * 4u + kq][kc])), s); }');
  L.push('    }');
  L.push('    s = s * p.scale; if (p.cap > 0.0) { s = p.cap * tanh(clamp(s / p.cap, vec4<f32>(-15.0), vec4<f32>(15.0))); }');
  L.push('    let kj = k0 + tx; let qi = q0 + ty * 4u + vec4<u32>(0u, 1u, 2u, 3u);');
  L.push('    var ok = vec4<bool>(kj < p.Lk);');
  L.push('    if (p.mode == 1u) { ok = ok & (vec4<u32>(kj) <= min(qi, vec4<u32>(p.nvalid - 1u))); } if (p.mode == 2u) { ok = ok & vec4<bool>(kj < p.nvalid); }');
  L.push('    s = select(vec4<f32>(-1.0e30), s, ok);');
  for (let r = 0; r < 4; r++) L.push(`    pS[tx * 16u + ty * 4u + ${r}u] = s[${r}];`);
  L.push('    workgroupBarrier();');
  L.push('    for (var t = li; t < 1024u; t = t + 64u) { sh[t] = Vb[kb + min(k0 + t / 64u, p.Lk - 1u) * 64u + t % 64u]; }');   // V into the same tile (scores are done)
  L.push('    if (li < 16u) { let mo = mS[li]; var mx = mo; for (var j = 0u; j < 16u; j = j + 1u) { mx = max(mx, pS[j * 16u + li]); }');
  L.push('      var sm = 0.0; for (var j = 0u; j < 16u; j = j + 1u) { let v = pS[j * 16u + li]; let e = select(exp(v - mx), 0.0, v <= -1.0e29); pS[j * 16u + li] = e; sm = sm + e; }');
  L.push('      let al = exp(mo - mx); aS[li] = al; lS[li] = lS[li] * al + sm; mS[li] = mx; }');
  L.push('    workgroupBarrier();');
  for (let r = 0; r < 4; r++) { L.push(`    { let al = aS[ty * 4u + ${r}u];`); for (let c = 0; c < 4; c++) L.push(`      o${r}${c} = o${r}${c} * al;`); L.push('    }'); }
  L.push('    for (var j = 0u; j < 16u; j = j + 1u) { let pb = j * 16u + ty * 4u; let pv = vec4<f32>(pS[pb], pS[pb + 1u], pS[pb + 2u], pS[pb + 3u]); let vb = j * 64u + tx * 4u;');
  for (let c = 0; c < 4; c++) L.push(`      let v${c} = vec4<f32>(sh[vb + ${c}u]);`);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) L.push(`      o${r}${c} = fma(vec4<f32>(pv[${r}]), v${c}, o${r}${c});`);
  L.push('    }');
  L.push('  }');
  L.push('  workgroupBarrier();');
  for (let r = 0; r < 4; r++) {
    L.push(`  { let qi = q0 + ty * 4u + ${r}u; let inv = 1.0 / lS[ty * 4u + ${r}u]; if (qi < p.Lq) { let ob = (qi * p.ldo + h * 256u) / 4u + tx * 4u;`);
    for (let c = 0; c < 4; c++) L.push(`    Ob[ob + ${c}u] = vec4<f16>(o${r}${c} * inv);`);
    L.push('  } }');
  }
  L.push('}');
  return L.join('\n');
}
/** q:[Hq][Lq][256], k/v:[Hkv][Lk][256] f16 head-major; o: [Lq][ldo] token-major at h*256.  mode 0 none, 1 causal+valid, 2 valid-length; cap: soft-cap */
function attn256(gpu, a) {
  const F = gpu.tune && gpu.tune.attnF256;   // p0pc0rn v028: the phone-tuned kernel (ops/attention.js attnF), every mode
  if (F && attnFFits(gpu, Object.assign({ D: 256 }, F))) { attnF(gpu, a, Object.assign({ D: 256, flavour: 'v', rate: gpu.rate.attn }, F)); return 4 * a.Lq * (a.Lk || a.Lq) * 256 * a.Hq * (a.mode === 1 ? 0.5 : 1); }
  const small = ((gpu.limits && gpu.limits.maxComputeWorkgroupStorageSize) || 16384) < 25792;   // v026.9: 25.2 KB -> the 9.2 KB variant
  const pipe = small ? gpu.pipeline('attn256s', attn256SplitCode) : gpu.pipeline('attn256', attn256Code);
  const Hq = a.Hq, Hkv = a.Hkv || Hq, Lq = a.Lq, Lk = a.Lk || Lq, ldo = a.o.ld || Hq * 256, qt = Math.ceil(Lq / 16);
  const r256 = gpu.rate.attn / 3, fWG = 4 * 16 * Lk * 256, cap = r256 * gpu.opts.maxDispatchSeconds;   // v028: this kernel runs at ~1/3 of the 128-d attention rate; full-size dispatches (0.6 s) reset the iPhone's GPU at 720p
  let qPer = qt, hPer = Math.max(1, Math.floor(cap / (fWG * qt)));
  if (fWG * qt > cap) { hPer = 1; qPer = Math.max(1, Math.floor(cap / fWG)); }
  const binds = [bw(a.q.buf, a.q.off || 0, Hq * Lq * 512), bw(a.k.buf, a.k.off || 0, Hkv * Lk * 512), bw(a.v.buf, a.v.off || 0, Hkv * Lk * 512), bw(a.o.buf, a.o.off || 0)];
  for (let h0 = 0; h0 < Hq; h0 += hPer) for (let q0 = 0; q0 < qt; q0 += qPer) {
    const nh = Math.min(hPer, Hq - h0), nq = Math.min(qPer, qt - q0);
    gpu.runner.dispatch(pipe, binds, P().u32(Lq).u32(Lk).u32(ldo).u32(Hq).u32(Hkv).f32(a.scale != null ? a.scale : 1 / 16).u32(a.mode || 0).u32(a.nvalid || Lk).u32(q0).u32(h0).f32(a.cap || 0).u32(0).ab,
      [nq, nh], fWG * nq * nh / r256);
  }
  return 4 * Lq * Lk * 256 * Hq * (a.mode === 1 ? 0.5 : 1);
}

// ------------------------------------------------------------------ attnres: depth aggregation over <= 8 sources
const ATTNRES = `
enable f16;
struct P { N: u32, D: u32, ns: u32, stride: u32, eps: f32, qOff: u32, r0: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> S: array<vec2<f16>>;     // sources [ns][N][D] (stride = N*D halves)
@group(0) @binding(2) var<storage, read> Q: array<f32>;          // projection weight [D] at qOff
@group(0) @binding(3) var<storage, read_write> O: array<vec2<f32>>; // hidden [N][D] fp32
var<workgroup> r1: array<f32, 256>; var<workgroup> r2: array<f32, 256>; var<workgroup> lg: array<f32, 8>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let n = wid.x + wid.y * 65535u + p.r0; if (n >= p.N) { return; }
  let D2 = p.D / 2u;
  for (var i = 0u; i < p.ns; i = i + 1u) {
    let b = (i * p.stride + n * p.D) / 2u; var ss = 0.0; var dq = 0.0;
    for (var c = t; c < D2; c = c + 256u) { let v = vec2<f32>(S[b + c]); ss = ss + dot(v, v); dq = dq + dot(v, vec2<f32>(Q[p.qOff + 2u * c], Q[p.qOff + 2u * c + 1u])); }
    r1[t] = ss; r2[t] = dq; workgroupBarrier();
    for (var s = 128u; s > 0u; s = s >> 1u) { if (t < s) { r1[t] = r1[t] + r1[t + s]; r2[t] = r2[t] + r2[t + s]; } workgroupBarrier(); }
    if (t == 0u) { lg[i] = r2[0] * inverseSqrt(r1[0] / f32(p.D) + p.eps); }
    workgroupBarrier();
  }
  var mx = -1.0e30; for (var i = 0u; i < p.ns; i = i + 1u) { mx = max(mx, lg[i]); }
  var z = 0.0; for (var i = 0u; i < p.ns; i = i + 1u) { z = z + exp(lg[i] - mx); }
  for (var c = t; c < D2; c = c + 256u) {
    var acc = vec2<f32>(0.0);
    for (var i = 0u; i < p.ns; i = i + 1u) { acc = acc + exp(lg[i] - mx) / z * vec2<f32>(S[(i * p.stride + n * p.D) / 2u + c]); }
    O[n * D2 + c] = acc;
  }
}`;
function attnres(gpu, a) {
  const pipe = gpu.pipeline('attnres', () => ATTNRES);
  for (let r0 = 0; r0 < a.N; r0 += 65535 * 64) {
    const n = Math.min(65535 * 64, a.N - r0);
    gpu.runner.dispatch(pipe, [bw(a.src.buf), bw(a.q.buf), bw(a.out.buf)], P().u32(a.N).u32(a.D).u32(a.ns).u32(a.N * a.D).f32(a.eps || 1e-6).u32(a.q.off || 0).u32(r0).u32(0).ab,
      [Math.min(n, 65535), Math.ceil(n / 65535)], n * a.D * a.ns * 4 / gpu.rate.mem);
  }
}

// ------------------------------------------------------------------ pixstats: rstd per voxel over C channels (LTX PixelNorm, eps 1e-8)
const PIXSTATS = `
enable f16;
struct P { V: u32, C: u32, eps: f32, ro: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<vec4<f16>>;
@group(0) @binding(2) var<storage, read_write> R: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let v = g.x + g.y * nw.x * 64u; if (v >= p.V) { return; }
  let c4 = p.C / 4u; var s = 0.0;
  for (var c = 0u; c < c4; c = c + 1u) { let x = vec4<f32>(X[v * c4 + c]); s = s + dot(x, x); }
  R[v + p.ro] = inverseSqrt(s / f32(p.C) + p.eps);
}`;
function pixstats(gpu, a) {
  const pipe = gpu.pipeline('pixstats', () => PIXSTATS), wgs = Math.ceil(a.V / 64);
  gpu.runner.dispatch(pipe, [bw(a.x.buf, a.x.off || 0), bw(a.r.buf)], P().u32(a.V).u32(a.C).f32(a.eps || 1e-8).u32(a.ro || 0).ab,
    [Math.min(wgs, 65535), Math.ceil(wgs / 65535)], a.V * a.C * 2 / gpu.rate.mem);
}

// ------------------------------------------------------------------ d2s: [T][H][W][C*p1*p2*p3] -> [T*p1-(p1-1)][H*p2][W*p3][C]
const D2S = `
enable f16;
struct P { T: u32, H: u32, W: u32, C: u32, p1: u32, p2: u32, p3: u32, To: u32, sk: u32, q0: u32, q1: u32, q2: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;
@group(0) @binding(2) var<storage, read_write> Y: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = g.x + g.y * nw.x * 256u; let C2 = p.C / 2u; let Ho = p.H * p.p2; let Wo = p.W * p.p3;
  if (i >= p.To * Ho * Wo * C2) { return; }
  let c = (i % C2) * 2u; let vox = i / C2; let ox = vox % Wo; let oy = (vox / Wo) % Ho; let ot = vox / (Wo * Ho) + p.sk;
  let it = ot / p.p1; let i1 = ot % p.p1; let iy = oy / p.p2; let i2 = oy % p.p2; let ix = ox / p.p3; let i3 = ox % p.p3;
  let PP = p.p1 * p.p2 * p.p3; let r = (i1 * p.p2 + i2) * p.p3 + i3;
  let src = ((it * p.H + iy) * p.W + ix) * p.C * PP;
  Y[i] = pack2x16float(vec2<f32>(f32(X[src + c * PP + r]), f32(X[src + (c + 1u) * PP + r])));
}`;
function d2s(gpu, a) {
  // p0pc0rn v029 time chunks: sk = leading (t p1) frames of this input to skip (p1 - 1 for the clip's first chunk, else 0), To = frames out
  const sk = a.sk != null ? a.sk : a.p1 - 1, To = a.To != null ? a.To : a.T * a.p1 - sk;
  const pipe = gpu.pipeline('d2s', () => D2S), n = To * a.H * a.p2 * a.W * a.p3 * a.C / 2, wgs = Math.ceil(n / 256);
  gpu.runner.dispatch(pipe, [bw(a.x.buf, a.x.off || 0), bw(a.y.buf, a.y.off || 0)], P().u32(a.T).u32(a.H).u32(a.W).u32(a.C).u32(a.p1).u32(a.p2).u32(a.p3).u32(To).u32(sk).u32(0).u32(0).u32(0).ab,
    [Math.min(wgs, 65535), Math.ceil(wgs / 65535)], n * 8 / gpu.rate.mem);
  return To;
}

return { laprep, kvstate, attn256, attnres, pixstats, d2s };
})();
// ---- ops/video2.js
__M["ops/video2.js"] = (() => {
// Small kernels for the video stage (SANA-Video 2.0 DiT, Gemma-2 text encoder, LTX-2.3 decoder output), on top of ops/video.js.
//   rmshead   : per-row RMSNorm over D (optional weight), optional rotate-half RoPE (Gemma), written head-major [H][Ltot][hd] or token-major
//   normadd   : Gemma post-norm residual: x_f32 += t * rsqrt(mean(t^2) + eps) * w   (w stored as 1 + w)
//   vops      : elementwise: add32 (y += a, or y = a), add16 (y16 = a + b), mulsig (o16 *= sigmoid(g16)), addvec (f32 = f32 + f16 broadcast),
//               dmd (x = c1 (x - s v) + c2 noise), ltxrgba (LTX decoder conv_out 4x4 unpatchify -> RGBA8 frames, tile core crop)
// Stores are u32-packed f16 pairs (no single-component writes of shared vectors anywhere).
'use strict';
const { P } = __M["core/gpu.js"];
const bw = (b, off = 0, size = null) => ({ buffer: b, offset: off, size: Math.floor((size == null ? b._pf - off : size) / 16) * 16 });
const dummy = (g, i) => { g._vdummies = g._vdummies || []; return g._vdummies[i] || (g._vdummies[i] = g.buffer(256, 'vdummy' + i)); };

// ------------------------------------------------------------------ rmshead
const RMSHEAD = `
enable f16;
struct P { M: u32, D: u32, hd: u32, ldx: u32, x0: u32, norm: u32, eps: f32, wOff: u32, rope: u32, out: u32, Ltot: u32, rowOff: u32, ldy: u32, y0: u32, r0: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<u32>;      // f16 pairs, row-major [M][ldx]
@group(0) @binding(2) var<storage, read> W: array<f32>;
@group(0) @binding(3) var<storage, read> RP: array<f32>;     // rope [row][hd/2][cos, sin] (rotate-half pairs (d, d + hd/2))
@group(0) @binding(4) var<storage, read_write> O: array<u32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x + wid.y * 65535u + p.r0; if (m >= p.M) { return; }
  let xb = (m * p.ldx + p.x0) / 2u; let D2 = p.D / 2u;
  var rs = 1.0;
  if (p.norm == 1u) {
    var s = 0.0; for (var i = t; i < D2; i = i + 256u) { let v = unpack2x16float(X[xb + i]); s = s + dot(v, v); }
    red[t] = s; workgroupBarrier();
    for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
    rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  }
  let half = p.hd / 2u;
  if (p.rope == 1u) {   // thread owns pairs (d, d+1) and their rotate-half partners (d + half, d + half + 1)
    let nq = p.D / 4u;
    for (var i = t; i < nq; i = i + 256u) {
      let h = i / (half / 2u); let d = (i % (half / 2u)) * 2u; let c = h * p.hd + d;
      var a = unpack2x16float(X[xb + c / 2u]); var b = unpack2x16float(X[xb + (c + half) / 2u]);
      if (p.norm == 1u) { a = a * rs * vec2<f32>(W[p.wOff + c], W[p.wOff + c + 1u]); b = b * rs * vec2<f32>(W[p.wOff + c + half], W[p.wOff + c + half + 1u]); }
      let rb = ((p.rowOff + m) * half + d) * 2u;
      let cs = vec2<f32>(RP[rb], RP[rb + 2u]); let sn = vec2<f32>(RP[rb + 1u], RP[rb + 3u]);
      let lo = a * cs - b * sn; let hi = b * cs + a * sn;
      let ob = ((h * p.Ltot + p.rowOff + m) * p.hd + d) / 2u;
      O[ob] = pack2x16float(lo); O[ob + half / 2u] = pack2x16float(hi);
    }
  } else {
    for (var i = t; i < D2; i = i + 256u) {
      let c = 2u * i; var v = unpack2x16float(X[xb + i]);
      if (p.norm == 1u) { v = v * rs * vec2<f32>(W[p.wOff + c], W[p.wOff + c + 1u]); }
      if (p.out == 1u) { O[(m * p.ldy + p.y0) / 2u + i] = pack2x16float(v); }
      else { let h = c / p.hd; let d = c % p.hd; O[((h * p.Ltot + p.rowOff + m) * p.hd + d) / 2u] = pack2x16float(v); }
    }
  }
}`;
/** x:{buf, off?, ld, c0 (column)} f16; D columns; hd head dim; w:{buf, off(floats)}|null; rope:{buf}|null (rotate-half, rows rowOff+m);
 *  out:{buf, off?} head-major [H][Ltot][hd] at rows rowOff.. (or tok: {ld, c0} token-major) */
function rmshead(gpu, a) {
  const pipe = gpu.pipeline('rmshead', () => RMSHEAD), tok = !!a.tok;
  for (let r0 = 0; r0 < a.M; r0 += 65535 * 32) {
    const n = Math.min(65535 * 32, a.M - r0);
    gpu.runner.dispatch(pipe, [bw(a.x.buf, a.x.off || 0), bw(a.w ? a.w.buf : dummy(gpu, 0)), bw(a.rope ? a.rope.buf : dummy(gpu, 1)), bw(a.out.buf, a.out.off || 0)],
      P().u32(a.M).u32(a.D).u32(a.hd || 128).u32(a.x.ld).u32(a.x.c0 || 0).u32(a.w ? 1 : 0).f32(a.eps || 1e-6).u32(a.w ? a.w.off || 0 : 0).u32(a.rope ? 1 : 0)
        .u32(tok ? 1 : 0).u32(a.Ltot || a.M).u32(a.rowOff || 0).u32(tok ? a.tok.ld : 0).u32(tok ? a.tok.c0 || 0 : 0).u32(r0).u32(0).ab,
      [Math.min(n, 65535), Math.ceil(n / 65535)], n * a.D * 6 / gpu.rate.mem);
  }
}

// ------------------------------------------------------------------ normadd (Gemma-2 post-attention / post-feedforward norms)
const NORMADD = `
struct P { M: u32, D: u32, eps: f32, wOff: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> T: array<f32>;
@group(0) @binding(2) var<storage, read> W: array<f32>;
@group(0) @binding(3) var<storage, read_write> X: array<f32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let b = m * p.D;
  var s = 0.0; for (var i = t; i < p.D; i = i + 256u) { let v = T[b + i]; s = s + v * v; }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  for (var i = t; i < p.D; i = i + 256u) { X[b + i] = X[b + i] + T[b + i] * rs * W[p.wOff + i]; }
}`;
function normadd(gpu, a) {
  gpu.runner.dispatch(gpu.pipeline('normadd', () => NORMADD), [bw(a.t.buf), bw(a.w.buf), bw(a.x.buf, a.x.off || 0)],
    P().u32(a.M).u32(a.D).f32(a.eps || 1e-6).u32(a.w.off || 0).ab, [a.M, 1], a.M * a.D * 12 / gpu.rate.mem);
}

// ------------------------------------------------------------------ vops
const VOPS = `
enable f16;
struct P { op: u32, n: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, s0: f32, s1: f32, s2: f32, g: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> AF: array<f32>;
@group(0) @binding(2) var<storage, read> BF: array<f32>;
@group(0) @binding(3) var<storage, read> AH: array<f16>;
@group(0) @binding(4) var<storage, read_write> YF: array<f32>;
@group(0) @binding(5) var<storage, read_write> YU: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  for (var i = gid.x; i < p.n; i = i + nw.x * 256u) {
    switch p.op {
      case 0u: { if (p.a == 1u) { YF[i] = AF[i]; } else { YF[i] = YF[i] + AF[i]; } }                 // add32 (a=1: store)
      case 1u: { let j = 2u * i; YU[i] = pack2x16float(vec2<f32>(AF[j] + BF[j], AF[j + 1u] + BF[j + 1u])); }   // add16: y16 = a + b (n = pairs)
      case 2u: { let j = 2u * i; let col = j % p.a; let row = j / p.a;                                 // mulsig: o16 *= sigmoid(g16[row*ldg + col])
        let o = unpack2x16float(YU[i]); let g = vec2<f32>(f32(AH[row * p.b + col]), f32(AH[row * p.b + col + 1u]));
        YU[i] = pack2x16float(o / (vec2<f32>(1.0) + exp(-g))); }
      case 3u: { YF[i] = AF[p.a + i] + f32(AH[p.b + i % p.c]); }                                         // addvec: y = a[aOff + i] + h[hOff + i % mod]
      case 4u: { YF[i] = p.s1 * (YF[i] - p.s0 * AF[i]) + p.s2 * BF[i]; }                               // dmd: x = (1-s') (x - s v) + s' noise
      case 5u: {   // ltxrgba: conv_out [F][h4][w4][48] f32 -> RGBA8 frames [F][H][W] (tile: core rows/cols in tile coords, written at the frame origin)
        let tw = p.c - p.b; let px = i % tw; let rest = i / tw; let th = p.e - p.d; let py = rest % th; let f = rest / th;   // b..c = core x range, d..e = core y range (tile pixels)
        let x = p.b + px; let y = p.d + py; let w4 = p.f >> 16u; let h4 = p.f & 65535u;
        let vox = (f * h4 + y / 4u) * w4 + x / 4u; let q = (x % 4u) * 4u + (y % 4u);
        var u = vec3<u32>(0u);
        for (var cc = 0u; cc < 3u; cc = cc + 1u) { u[cc] = u32(clamp(127.5 * AF[vox * 48u + cc * 16u + q] + 127.5, 0.0, 255.0)); }
        let W = p.g >> 16u; let H = p.g & 65535u; let fx = p.a >> 16u; let fy = p.a & 65535u;
        YU[(f * H + fy + py) * W + fx + px] = u.x | (u.y << 8u) | (u.z << 16u) | (255u << 24u); }
      case 6u: {   // ltxin: latent tokens f32 [T][h][w][128] tile (x0, y0, tw, th) -> z * std + mean -> f16 THWC pairs   a=w b=h c=x0|y0<<16 d=meanOff e=stdOff f=tw|th<<16
        let tw = p.f & 65535u; let th = p.f >> 16u; let c = (i % 64u) * 2u; let vox = i / 64u; let j = vox % tw; let ii = (vox / tw) % th; let t = vox / (tw * th);
        let src = ((t * p.b + (p.c >> 16u) + ii) * p.a + (p.c & 65535u) + j) * 128u + c;
        YU[i] = pack2x16float(vec2<f32>(AF[src] * BF[p.e + c] + BF[p.d + c], AF[src + 1u] * BF[p.e + c + 1u] + BF[p.d + c + 1u])); }
      case 7u: {   // crop: f16 THWC [T][H][W][C] region (x0, y0, w, h) -> [T][h][w][C]   a=C/2 b=W c=H d=x0|y0<<16 e=w|h<<16
        let w = p.e & 65535u; let h = p.e >> 16u; let c2 = i % p.a; let vox = i / p.a; let j = vox % w; let ii = (vox / w) % h; let t = vox / (w * h);
        let src = 2u * (((t * p.c + (p.d >> 16u) + ii) * p.b + (p.d & 65535u) + j) * p.a + c2);
        YU[i] = pack2x16float(vec2<f32>(f32(AH[src]), f32(AH[src + 1u]))); }
      case 8u: {   // ltxrgba16: conv_out f16 [F][h4][w4][48] -> RGBA8 [nf][ch][cw] for frames a.., core x b..c / y d..e (tile pixels); f = w4<<16 | h4
        let cw = p.c - p.b; let chh = p.e - p.d; let px = i % cw; let rest = i / cw; let py = rest % chh; let fr = p.a + rest / chh;
        let x = p.b + px; let y = p.d + py; let w4 = p.f >> 16u; let h4 = p.f & 65535u;
        let src = ((fr * h4 + y / 4u) * w4 + x / 4u) * 48u + (x % 4u) * 4u + (y % 4u);
        let r = u32(clamp(127.5 * f32(AH[src]) + 127.5, 0.0, 255.0)); let g = u32(clamp(127.5 * f32(AH[src + 16u]) + 127.5, 0.0, 255.0));
        let b = u32(clamp(127.5 * f32(AH[src + 32u]) + 127.5, 0.0, 255.0));
        YU[i] = r | (g << 8u) | (b << 16u) | (255u << 24u); }
      default: {}
    }
  }
}`;
const VOP = { add32: 0, add16: 1, mulsig: 2, addvec: 3, dmd: 4, ltxrgba: 5, ltxin: 6, crop: 7, ltxrgba16: 8 };
/** a = {op, n, af, bf, ah, yf, yu: {buf, off}, a..g u32, s0..s2 f32} */
function vop(gpu, a) {
  const pipe = gpu.pipeline('vops', () => VOPS), b = (t, i) => (t ? bw(t.buf, t.off || 0, t.size) : bw(dummy(gpu, i)));
  gpu.runner.dispatch(pipe, [b(a.af, 2), b(a.bf, 3), b(a.ah, 4), b(a.yf, 5), b(a.yu, 6)],
    P().u32(VOP[a.op]).u32(a.n).u32(a.a || 0).u32(a.b || 0).u32(a.c || 0).u32(a.d || 0).u32(a.e || 0).u32(a.f || 0).f32(a.s0 || 0).f32(a.s1 || 0).f32(a.s2 || 0).u32(a.g || 0).ab,
    [Math.min(Math.ceil(a.n / 256), 16384), 1], a.n * 12 / gpu.rate.mem);
}

// ------------------------------------------------------------------ RoPE tables (JS, float64 angles -> f32)
/** Wan 3-D RoPE for SANA: tokens (f, i, j) row-major; pairs split t/h/w = pt/ph/pw (head 128: 22/21/21, head 256: 44/42/42); [N][pairs][cos, sin] */
function ropeWan(T, H, W, pairs) {
  const [pt, ph, pw] = pairs, np = pt + ph + pw, out = new Float32Array(T * H * W * np * 2);
  const fr = (n) => Array.from({ length: n }, (_, k) => Math.pow(10000, -2 * k / (2 * n)));
  const ft = fr(pt), fh = fr(ph), fw = fr(pw);
  let o = 0;
  for (let f = 0; f < T; f++) for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
    for (let k = 0; k < pt; k++) { const a = f * ft[k]; out[o++] = Math.cos(a); out[o++] = Math.sin(a); }
    for (let k = 0; k < ph; k++) { const a = i * fh[k]; out[o++] = Math.cos(a); out[o++] = Math.sin(a); }
    for (let k = 0; k < pw; k++) { const a = j * fw[k]; out[o++] = Math.cos(a); out[o++] = Math.sin(a); }
  }
  return out;
}
/** Gemma-2 RoPE (rotate-half, theta 1e4, head 256): [L][128][cos, sin]; inv_freq in float32 like HF */
function ropeGemma(L) {
  const out = new Float32Array(L * 256), f = Math.fround;
  const inv = Array.from({ length: 128 }, (_, d) => f(1 / f(Math.pow(10000, f((2 * d) / 256)))));
  for (let t = 0; t < L; t++) for (let d = 0; d < 128; d++) { const a = f(t * inv[d]); out[(t * 128 + d) * 2] = Math.cos(a); out[(t * 128 + d) * 2 + 1] = Math.sin(a); }
  return out;
}

// ------------------------------------------------------------------ rmsrow32: f32 rows -> RMSNorm * w -> f16 rows (token-major, row offset)
const RMSROW32 = `
struct P { M: u32, D: u32, eps: f32, wOff: u32, ldy: u32, y0: u32, rowOut: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> W: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<u32>;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) t: u32) {
  let m = wid.x; let D2 = p.D / 2u; let b = m * D2;
  var s = 0.0; for (var i = t; i < D2; i = i + 256u) { let v = X[b + i]; s = s + dot(v, v); }
  red[t] = s; workgroupBarrier();
  for (var k = 128u; k > 0u; k = k >> 1u) { if (t < k) { red[t] = red[t] + red[t + k]; } workgroupBarrier(); }
  let rs = inverseSqrt(red[0] / f32(p.D) + p.eps);
  for (var i = t; i < D2; i = i + 256u) { O[((p.rowOut + m) * p.ldy + p.y0) / 2u + i] = pack2x16float(X[b + i] * rs * vec2<f32>(W[p.wOff + 2u * i], W[p.wOff + 2u * i + 1u])); }
}`;
/** x:{buf, off} f32 [M][D] -> out f16 [rowOut + m][ld] at column c0; w {buf, off(floats)} */
function rmsrow32(gpu, a) {
  gpu.runner.dispatch(gpu.pipeline('rmsrow32', () => RMSROW32), [bw(a.x.buf, a.x.off || 0), bw(a.w.buf), bw(a.out.buf)],
    P().u32(a.M).u32(a.D).f32(a.eps || 1e-6).u32(a.w.off || 0).u32(a.out.ld || a.D).u32(a.out.c0 || 0).u32(a.out.row || 0).u32(0).ab, [a.M, 1], a.M * a.D * 8 / gpu.rate.mem);
}

return { rmshead, normadd, vop, ropeWan, ropeGemma, rmsrow32 };
})();
// ---- core/store.js
__M["core/store.js"] = (() => {
// Weight pack store: download once (HTTP Range resume, per-16-MiB-chunk SHA-256 with native WebCrypto), keep in OPFS,
// stream shards to the GPU as a NEW buffer per shard filled with queue.writeBuffer (the fastest upload path on the iPhone probe:
// 2.18 GB/s).  Uploads are sequential with compute (the probe's overlap path was slower on the phone).  docs/FORMAT.md.
'use strict';
const { h2f } = __M["core/gpu.js"];
class Storage {
  constructor(url) { this.url = url || new URL('./opfs_worker.js', import.meta.url); this.id = 0; this.pend = new Map(); }
  async start() {
    if (this.closing) await this.closing;   // p0pc0rn v026.7: a retiring worker lets go of its file handles first
    if (this.w) return;
    const w = this.w = new Worker(this.url, { type: 'module' });
    w.onmessage = (ev) => { const m = ev.data; const p = this.pend.get(m.id); if (!p) return; this.pend.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); if (!this.pend.size && this.w === w) this._idle(); };
    w.onerror = (e) => { for (const p of this.pend.values()) p.rej(new Error('storage worker error: ' + (e.message || e))); this.pend.clear(); };
    const r = await this.call('hello');
    if (!r.sync) throw new Error('OPFS sync access handles are not available');
  }
  call(op, args = {}, transfer = []) {
    if (this.idleT) { clearTimeout(this.idleT); this.idleT = null; }
    if (!this.w) return this.start().then(() => this.call(op, args, transfer));   // v026.7: retired while idle: a new worker
    return new Promise((res, rej) => { const id = ++this.id; this.pend.set(id, { res, rej }); this.w.postMessage(Object.assign({ id, op }, args), transfer); });
  }
  /** p0pc0rn v026.7: idle for `idleMs` (20 s; 0 = never) -> close every file handle, terminate the worker (WebKit: a thread + a JS VM each) */
  _idle() {
    const ms = this.idleMs != null ? this.idleMs : 20000; if (!ms) return;
    if (this.idleT) clearTimeout(this.idleT);
    this.idleT = setTimeout(() => {
      this.idleT = null; const w = this.w; if (!w || this.pend.size) return;
      this.w = null; this.retired = (this.retired || 0) + 1;
      this.closing = new Promise((res) => {
        const id = ++this.id, end = () => { clearTimeout(to); try { w.terminate(); } catch (e) { /* */ } res(); }, to = setTimeout(end, 3000);
        this.pend.set(id, { res: end, rej: end }); w.postMessage({ id, op: 'closeAll' });
      }).then(() => { this.closing = null; });
    }, ms);
  }
}

const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');

/** p0pc0rn v027.3: pinned manifests (engine/core/pin.js, the same code): a pack's manifest.json is checked against the sha256 config.js
 *  carries for it before it is used or kept; a manifest that does not match is never used or stored. */
const pinHex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');
const pinAbs = (u) => { try { return new URL(u, globalThis.location ? globalThis.location.href : undefined).href; } catch (e) { return String(u); } };
const pinDir = (u) => String(u).replace(/\/?$/, '/');

/** the pin for the pack at `base`: undefined = no table at all (engine tests outside the app: not checked); null = a pack config.js
 *  does not list (refused); else {key, sha256}. A key 'pack/sub/' pins <pack address>sub/manifest.json (the songs' lyrics planner, lm/). */
function manifestPin(base) {
  const C = globalThis.P0_CONFIG;
  if (!C || !C.manifestSha256) return undefined;
  const want = pinAbs(pinDir(base));
  for (const k of Object.keys(C.manifestSha256)) {
    const i = k.indexOf('/'), key = i > 0 ? k.slice(0, i) : k, sub = i > 0 ? k.slice(i + 1) : '';
    const u = C.packs && C.packs[key];
    if (u && pinAbs(pinDir(u) + sub) === want) return { key: k, sha256: String(C.manifestSha256[k] || '').toLowerCase() };
  }
  return null;
}

/** fetch <base>manifest.json and check it: {ab, m, key} when it may be used and kept (ab = the exact bytes, to store as they are);
 *  {bad, key} when it must not be; null when it cannot be reached (offline, HTTP error). opts: fetch options; fetchFn: tests. */
async function fetchManifest(base, opts = {}, fetchFn = null) {
  const pin = manifestPin(base), key = pin ? pin.key : null;
  let ab;
  try {
    const r = await (fetchFn || fetch)(pinDir(base) + 'manifest.json', Object.assign({ cache: 'no-cache' }, opts));
    if (!r.ok) return null;
    ab = await r.arrayBuffer();
  } catch (e) { if (e && e.name === 'AbortError') throw e; return null; }
  if (pin === null) return { bad: 'this model pack is not one this version of p0pc0rn knows', key };
  if (pin) {
    if (!(globalThis.crypto && crypto.subtle)) return { bad: 'this browser cannot check the model list', key };
    if (pinHex(await crypto.subtle.digest('SHA-256', ab)) !== pin.sha256) return { bad: 'the model list on the server does not match this version of p0pc0rn', key };
  }
  let m;
  try { m = JSON.parse(new TextDecoder().decode(ab)); } catch (e) { return { bad: 'the model list is not readable', key }; }
  return { ab, m, key };
}

/** a refused manifest: one Diagnostics row (app.js listens); the phone's own copy, if any, stays in use */
function manifestRefused(got, kept) {
  try { globalThis.dispatchEvent(new CustomEvent('p0pc0rn:manifest', { detail: { pack: got.key || null, reason: got.bad, kept: !!kept } })); } catch (e) { /* no window */ }
}

class WeightStore {
  /** gpu: core Gpu; opts: {base: URL of the pack directory (manifest.json lives there), dir: OPFS folder, storage} */
  constructor(gpu, opts) {
    this.gpu = gpu; this.base = opts.base.endsWith('/') ? opts.base : opts.base + '/';
    this.dir = opts.dir || 'pocketflux'; this.st = opts.storage || new Storage();
    this.pool = []; this.stats = { uploadBytes: 0, uploadMs: 0, readMs: 0 };
    this.http = opts.source === 'http';
  }
  async open() {
    if (this.http) {
      const got = await fetchManifest(this.base);   // v027.3: checked against config.js before it is used
      if (!got || got.bad) { if (got) manifestRefused(got, false); throw new Error(got ? got.bad : 'pack manifest unavailable'); }
      const m = got.m;
      if (m.format !== 'pocketflux.pack' || m.format_version !== 1) throw new Error('unsupported pack format ' + m.format + '/' + m.format_version);
      this.m = m; this.shards = new Map(m.shards.map((s) => [s.name, s]));
      this.state = { pack_version: m.pack_version, done: Object.fromEntries(m.shards.map((s) => [s.name, { sha256: s.sha256, chunks: s.chunk_sha256.length }])) };
      return m;
    }
    await this.st.start();
    let m = null;
    // v027.3: the manifest is used and kept only when it matches config.js (its exact bytes are kept); offline or refused: the stored copy
    const got = await fetchManifest(this.base), path = `${this.dir}/manifest.json`;
    if (got && got.m) {
      m = got.m; const ab = got.ab;
      await this.st.call('write', { name: path, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('close', { name: path });
    } else {
      const sz = (await this.st.call('size', { name: path })).size;
      if (got) manifestRefused(got, sz > 0);
      if (sz <= 0) throw new Error(got ? got.bad : 'pack manifest unavailable (offline and not downloaded)');
      const r = await this.st.call('read', { name: path, at: 0, len: sz });
      m = JSON.parse(new TextDecoder().decode(new Uint8Array(r.buf, 0, sz)));
    }
    if (m.format !== 'pocketflux.pack' || m.format_version !== 1) throw new Error('unsupported pack format ' + m.format + '/' + m.format_version);
    this.m = m; this.shards = new Map(m.shards.map((s) => [s.name, s]));
    this.state = await this._loadState();
    return m;
  }
  async _loadState() {
    const p = `${this.dir}/state.json`, sz = (await this.st.call('size', { name: p })).size;
    if (sz <= 0) return { pack_version: this.m.pack_version, done: {} };
    const r = await this.st.call('read', { name: p, at: 0, len: sz });
    const s = JSON.parse(new TextDecoder().decode(new Uint8Array(r.buf, 0, sz)));
    return s;
  }
  async _saveState() {
    const ab = new TextEncoder().encode(JSON.stringify(this.state)).buffer, p = `${this.dir}/state.json`;
    await this.st.call('write', { name: p, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('flush', { name: p });
  }
  /** per-shard chunk bitmap ('1' = written + sha256-verified); also reads the v1 state ({chunks: n} = the first n chunks) */
  _bits(s) {
    const d = this.state.done[s.name], n = s.chunk_sha256.length;
    if (!d || d.sha256 !== s.sha256) return '0'.repeat(n);
    if (typeof d.bits === 'string' && d.bits.length === n) return d.bits;
    const k = Math.min(n, d.chunks | 0); return '1'.repeat(k) + '0'.repeat(n - k);
  }
  /** a shard is complete when every chunk is verified against the manifest (whose shard sha256 must match the stored one) */
  status() {
    let have = 0, total = 0; const missing = [];
    for (const s of this.m.shards) {
      total += s.bytes;
      const b = this._bits(s); let all = true;
      for (let i = 0; i < b.length; i++) { if (b[i] === '1') have += Math.min(s.chunk_bytes, s.bytes - i * s.chunk_bytes); else all = false; }
      if (!all) missing.push(s.name);
    }
    return { have, total, missing, complete: missing.length === 0 };
  }
  /** download everything missing as 16 MiB HTTP Range requests, `parallel` (default 4) in flight; each chunk is SHA-256 verified
   *  (native WebCrypto) and written to OPFS as it lands, a bad chunk is re-fetched (up to 4 tries).  Resumable per chunk: the state
   *  (a bitmap per shard) is saved every ~3 s from a snapshot taken BEFORE the flush, so a kill never marks unflushed data as done.
   *  onProgress({have, total, shard, bytesPerSec}); signal: AbortSignal (pause). */
  async download(opts = {}) {
    if (this.http) return this.status();
    const par = Math.max(1, Math.min(8, opts.parallel || 4)), t0 = performance.now(), st0 = this.status();
    const bits = new Map(this.m.shards.map((s) => [s.name, this._bits(s).split('')])), q = [], dirty = new Set();
    for (const s of this.m.shards) bits.get(s.name).forEach((b, i) => { if (b !== '1') q.push([s, i]); });
    let got = 0, lastSave = performance.now(), saving = null, err = null;
    const save = async () => {
      const snap = this.m.shards.map((s) => [s, bits.get(s.name).join('')]), files = Array.from(dirty); dirty.clear();
      for (const f of files) await this.st.call('flush', { name: f });
      for (const [s, b] of snap) { let k = 0; while (k < b.length && b[k] === '1') k++; this.state.done[s.name] = { sha256: s.sha256, bits: b, chunks: k }; }
      this.state.pack_version = this.m.pack_version; await this._saveState(); lastSave = performance.now();
    };
    const aborted = () => opts.signal && opts.signal.aborted;
    const worker = async () => {
      while (q.length && !err) {
        const [s, ci] = q.shift(), at = ci * s.chunk_bytes, len = Math.min(s.chunk_bytes, s.bytes - at), name = `${this.dir}/${s.file}`;
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok && !err; attempt++) {
          if (aborted()) throw new DOMException('aborted', 'AbortError');
          let ab = null;
          try {
            const r = await fetch(this.base + s.file, { headers: { Range: `bytes=${at}-${at + len - 1}` }, signal: opts.signal, cache: 'no-store' });
            if (r.status !== 206 && !(r.status === 200 && at === 0 && len === s.bytes)) {
              try { await r.body.cancel(); } catch (e) { /* an unread body would pin one of the browser's few connections */ }
              throw Object.assign(new Error(`download ${s.file}: HTTP ${r.status} (the pack server must honour HTTP Range requests)`), { fatal: r.status === 200 || r.status === 404 || r.status === 403 });
            }
            ab = await r.arrayBuffer();
          } catch (e) {
            if ((e && e.name === 'AbortError') || aborted()) throw new DOMException('aborted', 'AbortError');
            if (attempt === 3 || (e && e.fatal)) throw e;
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); continue;
          }
          if (ab.byteLength !== len || hex(await crypto.subtle.digest('SHA-256', ab)) !== s.chunk_sha256[ci]) continue;
          await this.st.call('write', { name, at, buf: ab }, [ab]);
          ok = true;
        }
        if (err) return;
        if (!ok) throw new Error(`download ${s.file}: chunk ${ci} failed verification 4 times`);
        bits.get(s.name)[ci] = '1'; dirty.add(name); got += len;
        if (opts.onProgress) opts.onProgress({ have: st0.have + got, total: st0.total, shard: s.name, bytesPerSec: got / ((performance.now() - t0) / 1000) });
        if (!saving && performance.now() - lastSave > 3000) { saving = save(); try { await saving; } finally { saving = null; } }
      }
    };
    await Promise.all(Array.from({ length: par }, () => worker().catch((e) => { if (!err) err = e; })));
    if (saving) await saving;
    await save(); await this.st.call('closeAll');
    this.stats.downloadBytes = got; this.stats.downloadSec = (performance.now() - t0) / 1000;
    if (err) throw err;
    return this.status();
  }
  async remove() { await this.st.call('remove', { name: this.dir }); this.state = { pack_version: this.m && this.m.pack_version, done: {} }; }

  // ------------------------------------------------------------------ direct-HTTP source (development / tests: no OPFS copy)
  async _range(file, at, len) {
    const r = await fetch(this.base + file, { headers: { Range: `bytes=${at}-${at + len - 1}` } });
    if (!r.ok) throw new Error(`fetch ${file}: HTTP ${r.status}`);
    const ab = await r.arrayBuffer();
    return r.status === 206 ? ab : ab.slice(at, at + len);
  }
  async _uploadHttp(s, buf) {
    const res = await fetch(this.base + s.file);
    if (!res.ok) throw new Error(`fetch ${s.file}: HTTP ${res.status}`);
    const rd = res.body.getReader(), CH = 16 * 1024 * 1024; let st = new Uint8Array(CH), fill = 0, off = 0;
    const put = (n) => { this.gpu.device.queue.writeBuffer(buf, off, st.buffer, 0, Math.ceil(n / 4) * 4); off += n; fill = 0; };
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      let v = value;
      while (v.length) { const k = Math.min(v.length, CH - fill); st.set(v.subarray(0, k), fill); fill += k; v = v.subarray(k); if (fill === CH) put(CH); }
    }
    if (fill) put(fill);
  }
  /** a whole pack file as an ArrayBuffer (tokenizer files, small tables) */
  async readFile(shardName) {
    const s = this.shards.get(shardName);
    if (this.http) return (await fetch(this.base + s.file)).arrayBuffer();
    const r = await this.st.call('read', { name: `${this.dir}/${s.file}`, at: 0, len: s.bytes });
    return r.buf.byteLength === s.bytes ? r.buf : r.buf.slice(0, s.bytes);
  }
  /** a few tensors of a shard in a NEW small buffer (e.g. img_in + final_layer.linear kept across the denoise loop) */
  async uploadPart(shardName, names) {
    const s = this.shards.get(shardName), T = this.m.tensors, A = 256;
    let tot = 0; const lay = names.map((n) => { const x = T[n]; const o = tot; tot += Math.ceil(x.bytes / A) * A; return [n, x, o]; });
    const buf = this.gpu.buffer(tot, 'part ' + shardName);
    for (const [, x, o] of lay) {
      const ab = this.http ? await this._range(s.file, x.offset, x.bytes) : (await this.st.call('read', { name: `${this.dir}/${s.file}`, at: x.offset, len: x.bytes })).buf;
      this.gpu.device.queue.writeBuffer(buf, o, ab, 0, Math.ceil(x.bytes / 4) * 4 <= ab.byteLength ? Math.ceil(x.bytes / 4) * 4 : x.bytes);
    }
    const map = new Map(lay.map(([n, x, o]) => [n, { buf, off: o, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }]));
    return { name: shardName + '(part)', buf, bytes: tot, t: (tn) => { const r = map.get(tn); if (!r) throw new Error(`tensor ${tn} not in part`); return r; } };
  }

  // ------------------------------------------------------------------ GPU upload: one NEW buffer per shard
  /** returns a ShardHandle {name, buf, bytes, t(tensorName)}; call release(h) when the block is done */
  async upload(shardName) {
    const s = this.shards.get(shardName);
    if (!s) throw new Error('unknown shard ' + shardName);
    const g = this.gpu, name = `${this.dir}/${s.file}`, CH = 16 * 1024 * 1024;
    const t0 = performance.now();
    const buf = this._reuse(s.bytes) || g.buffer(s.bytes, 'shard ' + shardName);   // p0pc0rn v024.1: the kept buffer of the same size
    if (this.http) {
      await this._uploadHttp(s, buf);
      this.stats.uploadBytes += s.bytes; this.stats.uploadMs += performance.now() - t0;
      return this._handle(shardName, buf, s.bytes);
    }
    const take = () => this.pool.pop() || new ArrayBuffer(CH);
    // p0pc0rn v024.1: the staging buffer is TRANSFERRED to the worker and back (zero-copy); a cloned one left 16 MB of garbage per chunk
    const read = (at, len) => { const b = take(); return this.st.call('read', { name, at, len, buf: b }, [b]); };
    let next = read(0, Math.min(CH, s.bytes));
    for (let off = 0; off < s.bytes; off += CH) {
      const r = await next;
      const nOff = off + CH;
      if (nOff < s.bytes) next = read(nOff, Math.min(CH, s.bytes - nOff));   // read-ahead (I/O only)
      g.device.queue.writeBuffer(buf, off, r.buf, 0, r.len);
      if (this.pool.length < 3) this.pool.push(r.buf);
    }
    this.stats.uploadBytes += s.bytes; this.stats.uploadMs += performance.now() - t0;
    return this._handle(shardName, buf, s.bytes);
  }
  _handle(shardName, buf, bytes) {
    const tensors = this.m.tensors, h = { name: shardName, buf, bytes };
    h.t = (tn) => { const x = tensors[tn]; if (!x || x.shard !== shardName) throw new Error(`tensor ${tn} not in ${shardName}`);
      return { buf: h.buf, off: x.offset, bytes: x.bytes, enc: x.enc, shape: x.shape, rows: x.shape[0], cols: x.shape[x.shape.length - 1] }; };
    return h;
  }
  /** p0pc0rn v024.1: release KEEPS the last released shard buffer for the next upload of the same size; any other upload destroys it first */
  release(h) {
    if (!h || !h.buf) return;
    const b = h.buf; h.buf = null;
    if (!this.gpu.bufs.has(b)) return;
    for (const x of this.gpool || []) this.gpu.free(x);
    this.gpool = [b];
  }
  _reuse(bytes) {
    const size = Math.max(16, Math.ceil(bytes / 16) * 16), P = this.gpool || [];
    this.gpool = [];
    let hit = null;
    for (const b of P) { if (!hit && b._pf === size && this.gpu.bufs.has(b)) hit = b; else this.gpu.free(b); }
    if (hit) this.gpu.runner.flush();
    return hit;
  }
  drainPool() { for (const b of this.gpool || []) this.gpu.free(b); this.gpool = []; }

  /** gather + dequantise rows of a *.rows tensor (TE embedding) -> Float32Array [ids.length, K] */
  async readRows(tensorName, ids) {
    const x = this.m.tensors[tensorName], s = this.shards.get(x.shard), K = x.shape[1];
    const q4 = x.enc === 'q4g32a.rows';
    if (!q4 && x.enc !== 'q8g64s.rows') throw new Error('readRows: ' + x.enc);
    const rb = q4 ? K / 2 + (K / 32) * 4 : K + (K / 64) * 2;
    let r;
    if (this.http) {
      const parts = await Promise.all(ids.map((i) => this._range(s.file, x.offset + i * rb, rb))), all = new Uint8Array(ids.length * rb);
      parts.forEach((ab, i) => all.set(new Uint8Array(ab), i * rb)); r = { buf: all.buffer };
    } else r = await this.st.call('readMany', { name: `${this.dir}/${s.file}`, ranges: ids.map((i) => [x.offset + i * rb, rb]) });
    const out = new Float32Array(ids.length * K), u8 = new Uint8Array(r.buf), dv = new DataView(r.buf);
    for (let i = 0; i < ids.length; i++) {
      const b = i * rb, o = i * K;
      if (q4) {
        for (let g = 0; g < K / 32; g++) {
          const sc = h2f(dv.getUint16(b + K / 2 + g * 4, true)), mn = h2f(dv.getUint16(b + K / 2 + g * 4 + 2, true));
          for (let j = 0; j < 16; j++) { const by = u8[b + g * 16 + j]; out[o + g * 32 + 2 * j] = (by & 15) * sc + mn; out[o + g * 32 + 2 * j + 1] = (by >> 4) * sc + mn; }
        }
      } else {
        for (let g = 0; g < K / 64; g++) {
          const sc = h2f(dv.getUint16(b + K + g * 2, true));
          for (let j = 0; j < 64; j++) out[o + g * 64 + j] = dv.getInt8(b + g * 64 + j) * sc;
        }
      }
    }
    return out;
  }
}

return { Storage, WeightStore };
})();
// ---- models/tokenizer.js
__M["models/tokenizer.js"] = (() => {
// Klein prompt tokenizer (SPEC 2.1-2.2): the vendored @huggingface/tokenizers (Apache-2.0, vendor/LICENSE-tokenizers.txt) driven by a
// tokenizer.json built here from the pack's verbatim Qwen2 files (vocab.json, merges.txt, tokenizer_config.json).
// The whole chat template is tokenized in one call (added tokens split first, NFC, the Qwen2 regex, byte-level BPE), exactly as
// the reference implementation does; then the prompt part is capped at 500 tokens and the sequence is right-padded with 151643 to 512.
'use strict';
const { Tokenizer } = __M["vendor/tokenizers.min.mjs"];
const PAD = 151643, MIN_LEN = 512, MAX_PROMPT = 500;
const PRE = [151644, 872, 198];
const SUF = [151645, 198, 151644, 77091, 198, 151667, 271, 151668, 271];
const REGEX = "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+";

/** vocab: object (vocab.json), mergesText: string (merges.txt), config: object (tokenizer_config.json) */
function buildTokenizer(vocab, mergesText, config) {
  const merges = mergesText.split('\n').filter((l) => l && !l.startsWith('#version'));
  const added = Object.entries(config.added_tokens_decoder || {}).map(([id, t]) => ({ id: +id, content: t.content,
    single_word: !!t.single_word, lstrip: !!t.lstrip, rstrip: !!t.rstrip, normalized: !!t.normalized, special: !!t.special }));
  const bl = { type: 'ByteLevel', add_prefix_space: false, trim_offsets: false, use_regex: false };
  const json = {
    version: '1.0', truncation: null, padding: null, added_tokens: added,
    normalizer: { type: 'NFC' },
    pre_tokenizer: { type: 'Sequence', pretokenizers: [{ type: 'Split', pattern: { Regex: REGEX }, behavior: 'Isolated', invert: false }, bl] },
    post_processor: bl, decoder: bl,
    model: { type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: '', end_of_word_suffix: '', fuse_unk: false,
      byte_fallback: false, ignore_merges: false, vocab, merges },
  };
  return new Tokenizer(json, config);
}

/** -> {ids: Int32Array(T), T, nvalid, promptTokens, truncated} */
function encodePrompt(tok, prompt, opts = {}) {
  const clean = String(prompt).split('<|endoftext|>').join('');
  const full = tok.encode(`<|im_start|>user\n${clean}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`, { add_special_tokens: false }).ids;
  const okPre = PRE.every((v, i) => full[i] === v), okSuf = SUF.every((v, i) => full[full.length - SUF.length + i] === v);
  if (!okPre || !okSuf) throw new Error('tokenizer: chat template ids mismatch');
  let mid = full.slice(PRE.length, full.length - SUF.length);
  const maxP = opts.maxPrompt || MAX_PROMPT, truncated = mid.length > maxP;
  if (truncated) mid = mid.slice(0, maxP);
  const seq = PRE.concat(mid, SUF), nvalid = seq.length, T = Math.max(opts.minLen || MIN_LEN, nvalid);
  const ids = new Int32Array(T).fill(PAD); ids.set(seq);
  return { ids, T, nvalid, promptTokens: mid.length, truncated };
}

return { PAD, PRE, SUF, buildTokenizer, encodePrompt };
})();
// ---- models/klein_blocks.js
__M["models/klein_blocks.js"] = (() => {
// FLUX.2 [klein] 4B building blocks on the Pocket Flux ops (SPEC.md sections 2.4 and 3.3), one streamed shard each.
// Residual streams are fp32; every matmul input is produced by a fused prologue (RMSNorm or LayerNorm+adaLN) in fp16;
// QK-RMSNorm + RoPE are fused into the qkv GEMM epilogue; gates + residual adds are fused into the output GEMMs (fp32).
// s.acc = GEMM accumulate mode for the block ('f32' | 'f16'; undefined = gpu.tune.acc).  The text encoder always uses 'f32'
// (f16 partial sums break its massive-activation rows: M7 audit).  Scratch buffers are owned by the caller (pipelines/*), sized by the memory plan in docs/ARCHITECTURE.md.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { attention } = __M["ops/attention.js"];
const { rowstats } = __M["ops/misc.js"];
const D = 3072, NH = 24, MLP = 9216, QK_EPS = 1.1920928955078125e-7;   // the reference implementation's fp32 RMSNorm eps (finfo(f32).eps)
const neg = (n) => (-n) >>> 0;                                            // u32 wrap for "shift = scale - 3072"

/** DiT RoPE table [L][64][cos, sin] from position ids [L][4] (axis a owns pairs 16a..16a+15, theta 2000), float64 angles */
function ropeDiT(ids, L) {
  const out = new Float32Array(L * 128);
  for (let t = 0; t < L; t++) for (let p = 0; p < 64; p++) {
    const a = p >> 4, d = p & 15, ang = ids[t * 4 + a] * Math.pow(2000, -d / 16);
    out[t * 128 + 2 * p] = Math.cos(ang); out[t * 128 + 2 * p + 1] = Math.sin(ang);
  }
  return out;
}
/** position ids for [txt T | img h x w | refs...] (SPEC 3.2) */
function ditIds(T, h, w, refs = []) {
  const n = T + h * w + refs.reduce((s, r) => s + r.h * r.w, 0), ids = new Float32Array(n * 4);
  let o = 0;
  for (let t = 0; t < T; t++, o++) ids[o * 4 + 3] = t;
  const grid = (hh, ww, idx) => { for (let i = 0; i < hh; i++) for (let j = 0; j < ww; j++, o++) { ids[o * 4] = idx; ids[o * 4 + 1] = i; ids[o * 4 + 2] = j; } };
  grid(h, w, 0); refs.forEach((r, k) => grid(r.h, r.w, 10 * (k + 1)));
  return ids;
}
/** Qwen RoPE table [T][64][cos, sin] (rotate_half layout, theta 1e6) */
function ropeTE(T) {
  const out = new Float32Array(T * 128);
  for (let t = 0; t < T; t++) for (let d = 0; d < 64; d++) {
    const ang = t * Math.pow(1e6, -2 * d / 128);
    out[t * 128 + 2 * d] = Math.cos(ang); out[t * 128 + 2 * d + 1] = Math.sin(ang);
  }
  return out;
}

/** Qwen3 layer.  s = {x (f32 [T][2560]), T, nvalid, stats, heads (f16 [48][T][128]), o (f16 [T][4096]), m (f16 [T][9728]), rope} */
function teLayer(g, sh, s, l) {
  const p = `model.layers.${l}.`, T = s.T, HD = 2560;
  const t = (n) => sh.t(p + n);
  const ln1 = t('input_layernorm.weight'), qkv = t('self_attn.qkv_proj.weight'), qn = t('self_attn.q_norm.weight');
  const o = t('self_attn.o_proj.weight'), ln2 = t('post_attention_layernorm.weight'), gu = t('mlp.gate_up_proj.weight'), dn = t('mlp.down_proj.weight');
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: qkv, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln1.off / 4 }, M: T, N: 6144, K: HD,
    epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: qn.off / 4 },
    heads: { Ltot: T, Hq: 32, Hkv: 8, rowOff: 0, eps: 1e-6, ropeMode: 'half', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: 32 * T * 256 }, v: { buf: s.heads, off: 40 * T * 256 },
    o: { buf: s.o, ld: 4096 }, Lq: T, Lk: T, Hq: 32, Hkv: 8, mode: 1, nvalid: s.nvalid });
  gemm(g, { acc: s.acc, w: o, x: { buf: s.o, ld: 4096 }, M: T, N: HD, K: 4096, epi: 'resadd', y: { buf: s.x, ld: HD } });
  rowstats(g, { x: { buf: s.x }, rows: T, cols: HD, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: gu, x: { buf: s.x, ld: HD, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: ln2.off / 4 }, M: T, N: 19456, K: HD,
    wr0: 0, wr1: 9728, epi: 'swiglu', y: { buf: s.m, ld: 9728 } });
  gemm(g, { acc: s.acc, w: dn, x: { buf: s.m, ld: 9728 }, M: T, N: HD, K: 9728, epi: 'resadd', y: { buf: s.x, ld: HD } });
}

/** modulation offsets (floats) inside s.mod: img [shift1, scale1, gate1, shift2, scale2, gate2], txt likewise, single [shift, scale, gate] */
function mlpChunks(g, sh, s, wName, w2Name, row0, rows, scaleOff, gateOff, swiglu) {
  for (let c0 = 0; c0 < rows; c0 += s.chunk) {
    const n = Math.min(s.chunk, rows - c0), r = row0 + c0;
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(wName), x: { buf: s.x, off: r * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: r },
      pv: { buf: s.mod, off: scaleOff, stride: neg(3072) }, M: n, K: D, epi: 'swiglu', y: { buf: s.m, ld: MLP } }, swiglu));
    gemm(g, Object.assign({ acc: s.acc, w: sh.t(w2Name), x: { buf: s.m, ld: MLP }, M: n, N: D, K: MLP, epi: 'resadd', y: { buf: s.x, off: r * D * 4, ld: D },
      ev: { buf: s.mod, off: gateOff } }, swiglu.w2 || {}));
  }
}

/** double block b.  s = {x f32 [L][3072] (txt rows 0..T-1 then img(+ref) rows), L, T, mod (f32), modImg, modTxt (float offsets),
 *  stats, heads (f16 [72][L][128]), o (f16 [L][3072]), m (f16 [chunk][9216]), rope (f32 [L][128]), chunk} */
function ditDouble(g, sh, s, b) {
  const p = `double_blocks.${b}.`, L = s.L, T = s.T, nI = L - T;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.qkv.weight`), x: { buf: s.x, off: row0 * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: s.stats, off: row0 },
      pv: { buf: s.mod, off: mo + 3072, stride: neg(3072) }, M: rows, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads },
      ev: { buf: sh.buf, off: sh.t(p + `${st}_attn.norm.query_norm.scale`).off / 4 },
      heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: row0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  }
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    gemm(g, { acc: s.acc, w: sh.t(p + `${st}_attn.proj.weight`), x: { buf: s.o, off: row0 * D * 2, ld: D }, M: rows, N: D, K: D, epi: 'resadd',
      y: { buf: s.x, off: row0 * D * 4, ld: D }, ev: { buf: s.mod, off: mo + 6144 } });
  }
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  for (const [st, row0, rows, mo] of [['img', T, nI, s.modImg], ['txt', 0, T, s.modTxt]]) {
    mlpChunks(g, sh, s, p + `${st}_mlp.0.weight`, p + `${st}_mlp.2.weight`, row0, rows, mo + 12288, mo + 15360, { N: 2 * MLP, wr0: 0, wr1: MLP });
  }
}

/** single block b (x = [txt | img | ref] rows), modulation at s.modSingle */
function ditSingle(g, sh, s, b) {
  const p = `single_blocks.${b}.`, L = s.L, mo = s.modSingle;
  rowstats(g, { x: { buf: s.x }, rows: L, cols: D, mode: 'ln', eps: 1e-6, st: { buf: s.stats } });
  gemm(g, { acc: s.acc, w: sh.t(p + 'linear1.weight'), x: { buf: s.x, ld: D, mode: 'lnmod' }, stats: { buf: s.stats }, pv: { buf: s.mod, off: mo + 3072, stride: neg(3072) },
    M: L, N: 3 * D, K: D, epi: 'heads', y: { buf: s.heads }, ev: { buf: sh.buf, off: sh.t(p + 'norm.query_norm.scale').off / 4 },
    heads: { Ltot: L, Hq: NH, Hkv: NH, rowOff: 0, eps: QK_EPS, ropeMode: 'inter', rope: { buf: s.rope } } });
  attention(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: NH * L * 256 }, v: { buf: s.heads, off: 2 * NH * L * 256 },
    o: { buf: s.o, ld: D }, Lq: L, Lk: L, Hq: NH, Hkv: NH, mode: 0 });
  // parallel block: the MLP half must read LN(x) of the block INPUT, so it runs before the attention half touches x
  // (each MLP chunk reads its rows through the fused LN prologue, then adds into the same rows only)
  if (s.parts !== 'attn') mlpChunks(g, sh, s, p + 'linear1.weight', p + 'linear2.weight', 0, L, mo + 3072, mo + 6144, { N: 2 * MLP, wr0: 3 * D, wr1: 3 * D + MLP, w2: { wk0: D } });
  if (s.parts !== 'mlp') gemm(g, { acc: s.acc, w: sh.t(p + 'linear2.weight'), x: { buf: s.o, ld: D }, wk0: 0, M: L, N: D, K: D, epi: 'resadd', y: { buf: s.x, ld: D }, ev: { buf: s.mod, off: mo + 6144 } });
}

return { ropeDiT, ditIds, ropeTE, teLayer, ditDouble, ditSingle };
})();
// ---- models/klein_te.js
__M["models/klein_te.js"] = (() => {
// Klein text encoder (SPEC 2): tokenizer -> embedding rows (store.readRows, JS dequant) -> Qwen3 layers 0..26 streamed one shard
// each -> conditioning [T][7680] = [x before L9 | x before L18 | x after L26], written as f16 (the DiT's txt_in reads f16; max |cond|
// ~16.4k fits).  Peak GPU ~105 MB at T = 512 (one 63 MB layer shard + 5 MB residual + scratch + 7.9 MB cond).
'use strict';
const { teLayer, ropeTE } = __M["models/klein_blocks.js"];
const { layout } = __M["ops/misc.js"];
const { buildTokenizer, encodePrompt } = __M["models/tokenizer.js"];
const HD = 2560, CD = 7680, LAYERS = 27;
const teFlops = (T) => 2 * T * LAYERS * (HD * 6144 + 4096 * HD + HD * 19456 + 9728 * HD) + LAYERS * 4 * T * T * 128 * 32 / 2;

class KleinTE {
  constructor(gpu, store) { this.g = gpu; this.store = store; this.tok = null; }
  async loadTokenizer() {
    if (this.tok) return this.tok;
    const d = new TextDecoder(), rd = async (n) => d.decode(await this.store.readFile(n));
    this.tok = buildTokenizer(JSON.parse(await rd('tokenizer.vocab')), await rd('tokenizer.merges'), JSON.parse(await rd('tokenizer.tokenizer_config')));
    return this.tok;
  }
  async tokenize(prompt) { return encodePrompt(await this.loadTokenizer(), prompt); }

  /** -> {cond (GPUBuffer f16 [T][7680]), T, nvalid}.  opts: {onLayer(l), check() (throws on cancel / lost)} */
  async encode(prompt, opts = {}) {
    const g = this.g, st = this.store, tk = await this.tokenize(prompt), T = tk.T;
    const uniq = Array.from(new Set(tk.ids)), rows = await st.readRows('model.embed_tokens.weight', uniq);
    const where = new Map(uniq.map((id, i) => [id, i])), x0 = new Float32Array(T * HD);
    for (let t = 0; t < T; t++) x0.set(rows.subarray(where.get(tk.ids[t]) * HD, (where.get(tk.ids[t]) + 1) * HD), t * HD);
    const s = { acc: 'f32', x: g.upload(x0, 'te.x'), T, nvalid: tk.nvalid, stats: g.buffer(T * 8, 'te.stats'), heads: g.buffer(48 * T * 256, 'te.heads'),
      o: g.buffer(T * 4096 * 2, 'te.o'), m: g.buffer(T * 9728 * 2, 'te.m'), rope: g.upload(ropeTE(T), 'te.rope') };
    const cond = g.buffer(T * CD * 2, 'cond');
    const tap = (col) => layout(g, { op: 'cast2d', n: T * HD, xf: { buf: s.x }, yh: { buf: cond }, a: HD, b: HD, c: 0, d: CD, e: col });
    let sh = null;
    try {
      sh = await st.upload('te.layer.00');
      for (let l = 0; l < LAYERS; l++) {
        if (l === 9) tap(0);
        if (l === 18) tap(HD);
        teLayer(g, sh, s, l);
        if (l === LAYERS - 1) tap(2 * HD);
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        st.release(sh);
        if (l + 1 < LAYERS) sh = await st.upload('te.layer.' + String(l + 1).padStart(2, '0'));
        await done;
        if (opts.check) opts.check();
        if (opts.onLayer) opts.onLayer(l);
      }
      await g.done();
    } catch (e) { g.free(cond); throw e; } finally { if (sh) st.release(sh); for (const k of ['x', 'stats', 'heads', 'o', 'm', 'rope']) g.free(s[k]); }
    return { cond, T, nvalid: tk.nvalid, promptTokens: tk.promptTokens, truncated: tk.truncated };
  }
}

return { teFlops, KleinTE };
})();
// ---- models/klein_dit.js
__M["models/klein_dit.js"] = (() => {
// Klein DiT + sampler (SPEC 3, 4, 6).  prepare(): dit.global streamed once -> txt0 = txt_in(cond) (f32, kept), the timestep MLP and
// the 4 modulation linears for ALL steps in one M = steps GEMM each (mod f32 [steps][52224], kept), img_in + final_layer.linear kept
// (0.8 MB), dit.global freed.  step(k): x = [txt0 | img_in(latent, refs)] -> 5 double + 20 single blocks streamed one shard each
// (the next shard uploads while the current block runs; at most one block in flight) -> final LN-mod + linear on the image rows ->
// Euler x += (s[k+1] - s[k]) v.  Residual streams fp32 throughout.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { rowstats, ew, layout } = __M["ops/misc.js"];
const { ditDouble, ditSingle, ropeDiT, ditIds } = __M["models/klein_blocks.js"];
const { toF16 } = __M["core/gpu.js"];
const D = 3072, MOD = 52224, f = Math.fround, neg = (n) => (-n) >>> 0;
const BLOCKS = [0, 1, 2, 3, 4].map((i) => 'dit.double.' + i).concat(Array.from({ length: 20 }, (_, i) => 'dit.single.' + String(i).padStart(2, '0')));

/** Flux2Scheduler sigmas, emulating the reference implementation's float32 torch arithmetic exactly (linspace, reciprocal-multiply division). */
function flux2Sigmas(W, H, steps) {
  const S = Math.round((W * H) / 256);
  let mu;
  if (S > 4300) mu = 0.00016927 * S + 0.45666666;
  else {
    const m200 = 0.00016927 * S + 0.45666666, m10 = 8.73809524e-5 * S + 1.89833333, a = (m200 - m10) / 190, b = m200 - 200 * a;
    mu = a * steps + b;
  }
  const n = steps + 1, step = f(-1 / f(n - 1)), half = Math.floor(n / 2), E = f(Math.exp(mu)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i < half ? f(1 + f(step * i)) : f(0 - f(step * (n - i - 1)));
    const den = f(E + f(f(1 / t) - 1));
    out[i] = f(f(1 / den) * E);
  }
  return out;
}
/** timestep embedding (SPEC 3.2): [cos(1000 s f_k) | sin(1000 s f_k)], f_k = exp(-ln(1e4) k / 128), float32 like torch */
function timestepEmb(sigma) {
  const e = new Float32Array(256), t = f(1000 * f(sigma)), c = f(-Math.log(10000));
  for (let k = 0; k < 128; k++) { const fr = f(Math.exp(f(f(c * k) / 128))), a = f(t * fr); e[k] = Math.cos(a); e[128 + k] = Math.sin(a); }
  return e;
}
const ditStepFlops = (L) => 2 * L * 3.0682e9 + 25 * 4 * L * L * 128 * 24;

class KleinDiT {
  constructor(gpu, store, opts = {}) { this.g = gpu; this.store = store; this.chunk = opts.chunk || 1024; this.acc = opts.acc || null; }

  /** cond {cond: f16 [T][7680], T}; sigmas Float32Array(steps+1); latent grid h x w; refs [{h, w, tokens: Float32Array [h*w][128]}] */
  async prepare(cond, sigmas, h, w, refs = [], opts = {}) {
    const g = this.g, T = cond.T, steps = sigmas.length - 1, nImg = h * w, nRef = refs.reduce((s, r) => s + r.h * r.w, 0), L = T + nImg + nRef;
    const S = { T, L, nImg, nRef, h, w, steps, sigmas, bufs: [] };
    const B = (n, l) => { const b = g.buffer(n, l); S.bufs.push(b); return b; };
    try {
      S.txt0 = B(T * D * 4, 'dit.txt0'); S.mod = B(steps * MOD * 4, 'dit.mod');
      const gl = await this.store.upload('dit.global');
      const tmp = [];
      try {
        gemm(g, { acc: 'f32', w: gl.t('txt_in.weight'), x: { buf: cond.cond, ld: 7680 }, M: T, N: D, K: 7680, epi: 'f32', y: { buf: S.txt0 } });
        const emb = new Float32Array(steps * 256);
        for (let k = 0; k < steps; k++) emb.set(timestepEmb(sigmas[k]), k * 256);
        const E = g.upload(toF16(emb), 'dit.temb'), h1 = g.buffer(steps * D * 2, 'dit.h1'), vec = g.buffer(steps * D * 2, 'dit.vec'); tmp.push(E, h1, vec);
        gemm(g, { acc: 'f32', w: gl.t('time_in.in_layer.weight'), x: { buf: E, ld: 256 }, M: steps, N: D, K: 256, epi: 'f16', y: { buf: h1 } });
        ew(g, { op: 'silu', n: steps * D, B: { buf: h1 } });
        gemm(g, { acc: 'f32', w: gl.t('time_in.out_layer.weight'), x: { buf: h1, ld: D }, M: steps, N: D, K: D, epi: 'f16', y: { buf: vec } });
        ew(g, { op: 'silu', n: steps * D, B: { buf: vec } });
        let n0 = 0;
        for (const [nm, N] of [['double_stream_modulation_img.lin.weight', 18432], ['double_stream_modulation_txt.lin.weight', 18432],
          ['single_stream_modulation.lin.weight', 9216], ['final_layer.adaLN_modulation.1.weight', 6144]]) {
          gemm(g, { acc: 'f32', w: gl.t(nm), x: { buf: vec, ld: D }, M: steps, N, K: D, epi: 'f32', y: { buf: S.mod, ld: MOD, n0 } }); n0 += N;
        }
        S.keep = await this.store.uploadPart('dit.global', ['img_in.weight', 'final_layer.linear.weight']); S.bufs.push(S.keep.buf);
        await g.done();
      } finally { this.store.release(gl); tmp.forEach((b) => g.free(b)); }
      S.rope = B(L * 128 * 4, 'dit.rope'); g.upload(ropeDiT(ditIds(T, h, w, refs), L), '', S.rope);
      S.tok = B((nImg + nRef) * 128 * 2, 'dit.tok16');
      if (nRef) {
        const rt = new Float32Array(nRef * 128); let o = 0;
        for (const r of refs) { rt.set(r.tokens, o); o += r.tokens.length; }
        g.upload(toF16(rt), '', S.tok, nImg * 256);
      }
      S.x = B(L * D * 4, 'dit.x'); S.stats = B(L * 8, 'dit.stats'); S.heads = B(72 * L * 256, 'dit.heads'); S.o = B(L * D * 2, 'dit.o');
      S.m = B(this.chunk * 9216 * 2, 'dit.mlp'); S.v = B(nImg * 128 * 4, 'dit.v');
    } catch (e) { this.free(S); throw e; }
    return S;
  }

  /** one sampler step k on latent (GPUBuffer f32 [nImg][128], updated in place).  opts {onBlock(i), check(), keepVelocity} */
  async step(S, k, latent, opts = {}) {
    const g = this.g, T = S.T;
    const s = { acc: this.acc || (g.tune && g.tune.acc) || 'f32', x: S.x, L: S.L, T, mod: S.mod, modImg: k * MOD, modTxt: k * MOD + 18432, modSingle: k * MOD + 36864,
      stats: S.stats, heads: S.heads, o: S.o, m: S.m, rope: S.rope, chunk: this.chunk };
    g.runner.copy(S.txt0, 0, S.x, 0, T * D * 4);
    layout(g, { op: 'cast16', n: S.nImg * 128, xf: { buf: latent }, yh: { buf: S.tok } });
    gemm(g, { acc: 'f32', w: S.keep.t('img_in.weight'), x: { buf: S.tok, ld: 128 }, M: S.nImg + S.nRef, N: D, K: 128, epi: 'f32', y: { buf: S.x, off: T * D * 4, ld: D } });
    let sh = await this.store.upload(BLOCKS[0]);
    try {
      for (let i = 0; i < BLOCKS.length; i++) {
        if (i < 5) ditDouble(g, sh, s, i); else ditSingle(g, sh, s, i - 5);
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        this.store.release(sh);
        if (i + 1 < BLOCKS.length) sh = await this.store.upload(BLOCKS[i + 1]);
        await done;
        if (opts.check) opts.check();
        if (opts.onBlock) opts.onBlock(i);
      }
    } finally { if (sh) this.store.release(sh); }
    rowstats(g, { x: { buf: S.x, off: T * D * 4 }, rows: S.nImg, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    gemm(g, { acc: 'f32', w: S.keep.t('final_layer.linear.weight'), x: { buf: S.x, off: T * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: S.stats, off: 0 },
      pv: { buf: S.mod, off: k * MOD + 46080 + 3072, stride: neg(3072) }, M: S.nImg, N: 128, K: D, epi: 'f32', y: { buf: S.v, ld: 128 } });
    ew(g, { op: 'axpy', n: S.nImg * 128, A: { buf: latent }, V: { buf: S.v }, alpha: f(S.sigmas[k + 1] - S.sigmas[k]) });
    await g.done();
  }
  free(S) { for (const b of S.bufs || []) this.g.free(b); S.bufs = []; }
}

return { flux2Sigmas, timestepEmb, ditStepFlops, KleinDiT };
})();
// ---- models/flux2_vae.js
__M["models/flux2_vae.js"] = (() => {
// FLUX.2 VAE (SPEC 5): exact decoder and encoder on full fp16 HWC tensors (no tiling, no seams).  GroupNorm statistics are exact over
// the whole tensor (per-chunk two-pass + Chan merge); GN-apply + SiLU is fused into the consuming conv's prologue, nearest-2x into the
// conv's input indexing, residual adds into the conv epilogue (in place).  Above `bandAboveMB` the up_blocks.2 upsample output (472 MB
// at 720p) is never materialised: pass A computes it in row bands for the up_blocks.3.res0 GroupNorm statistics and the 1x1 shortcut,
// pass B recomputes each band with a 1-row halo and feeds conv1 (+12 % FLOPs, peak ~0.73 GB at 720p incl. the 99 MB of weights).
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { gnPartial, gnFinalize, gnPartBytes, layout, convDirect, softmax, transpose16 } = __M["ops/misc.js"];
const vaeDecodeFlops = (H, W) => 9.62e6 * H * W;
const vaeEncodeFlops = (H, W) => 4.27e6 * H * W;

class Flux2VAE {
  constructor(gpu, opts = {}) {
    this.g = gpu; this.bandRows = opts.bandRows || 64; this.bandAboveMB = opts.bandAboveMB != null ? opts.bandAboveMB : 200;
    this.qChunk = opts.qChunk || 1024; this.acc = 'f32';
    this.picAcc = opts.picAcc || null;   // v029: the DECODER accumulates like g.tune.vaeAcc (fp16 partials per 32-k: -11% decode, 62-64 dB vs fp32); picAcc overrides; the encoder stays fp32
  }
  drop(...bs) { this.g.runner.flush(); for (const b of bs) this.g.free(b); }

  conv(c, x, name, o) {
    const w = c.sh.t(name + '.weight'), b = c.sh.t(name + '.bias'), ks = w.shape[1], Ci = w.shape[3], Co = o.N || w.shape[0], K = ks * ks * Ci;
    const pad = o.stride === 2 ? 0 : ks >> 1;
    gemm(this.g, { w: { buf: w.buf, off: w.off, bytes: w.bytes, enc: 'f16', rows: w.shape[0], cols: K }, x: { buf: x, off: o.xOff || 0, size: o.xSize },
      M: o.Ho * o.Wo, N: Co, K, epi: 'bias', res: !!o.res, ev: { buf: c.sh.buf, off: b.off / 4 }, acc: this.acc,
      pv: o.gn != null ? { buf: c.ab, off: o.gn, stride: Ci } : null, y: { buf: o.y, off: o.yOff || 0 },
      conv: { Hi: o.Hi, Wi: o.Wi, Ci, Ho: o.Ho, Wo: o.Wo, stride: o.stride || 1, padT: o.padT != null ? o.padT : pad, padL: o.padL != null ? o.padL : pad, ks, up2: !!o.up2, gn: o.gn != null } });
  }
  gn(c, x, pix, C, name, slot) {
    const off = slot * 1024, nwg = gnPartial(this.g, { x: { buf: x }, pix, C, part: c.part });
    gnFinalize(this.g, { part: c.part, nwg, C, gb: { buf: c.sh.buf, gOff: c.sh.t(name + '.weight').off, bOff: c.sh.t(name + '.bias').off }, ab: { buf: c.ab, off }, eps: 1e-6 });
    return off;
  }
  res(c, x, p, Ci, Co, H, W) {
    const g = this.g, pix = H * W;
    const a1 = this.gn(c, x, pix, Ci, p + '.norm1', 0), h = g.buffer(pix * Co * 2, 'vae.h');
    this.conv(c, x, p + '.conv1', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a1, y: h });
    const a2 = this.gn(c, h, pix, Co, p + '.norm2', 1);
    let out = x;
    if (Ci !== Co) { out = g.buffer(pix * Co * 2, 'vae.s'); this.conv(c, x, p + '.conv_shortcut', { Hi: H, Wi: W, Ho: H, Wo: W, y: out }); this.drop(x); }
    this.conv(c, h, p + '.conv2', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a2, y: out, res: true });
    this.drop(h);
    return out;
  }
  attn(c, x, p, H, W) {   // single head, d = 512, query chunks: S = Q K^T (f32) -> softmax -> P (f16) -> P V
    const g = this.g, n = H * W, C = 512, Kp = Math.ceil(n / 32) * 32, sh = c.sh;
    const a = this.gn(c, x, n, C, p + '.group_norm', 0), hn = g.buffer(n * C * 2, 'vae.attn.hn');
    layout(g, { op: 'chanAffine', n: n * C, xh: { buf: x }, v: { buf: c.ab }, yh: { buf: hn }, a: C, f: a });
    const lin = (src, name, dst, res) => { const w = sh.t(name + '.weight'), b = sh.t(name + '.bias');
      gemm(g, { w: { buf: w.buf, off: w.off, bytes: w.bytes, enc: 'f16', rows: C, cols: C }, x: { buf: src, ld: C }, M: n, N: C, K: C, epi: 'bias', res: !!res,
        ev: { buf: sh.buf, off: b.off / 4 }, y: { buf: dst, ld: C }, acc: this.acc }); };
    const q = g.buffer(n * C * 2, 'vae.attn.q'), k = g.buffer(n * C * 2, 'vae.attn.k'), v = g.buffer(Kp * C * 2, 'vae.attn.v');
    lin(hn, p + '.to_q', q); lin(hn, p + '.to_k', k); lin(hn, p + '.to_v', v);
    this.drop(hn);
    const vt = g.buffer(C * Kp * 2, 'vae.attn.vt');
    transpose16(g, { x: { buf: v }, y: { buf: vt }, R: Kp, C });
    this.drop(v);
    const o = g.buffer(n * C * 2, 'vae.attn.o'), qc = Math.min(this.qChunk, n), S = g.buffer(qc * Kp * 4, 'vae.attn.S'), P = g.buffer(qc * Kp * 2, 'vae.attn.P');
    for (let r0 = 0; r0 < n; r0 += qc) {
      const m = Math.min(qc, n - r0);
      gemm(g, { w: { buf: k, off: 0, bytes: n * C * 2, enc: 'f16', rows: n, cols: C }, x: { buf: q, off: r0 * C * 2, ld: C }, M: m, N: n, K: C, epi: 'f32', y: { buf: S, ld: Kp }, acc: 'f32' });
      softmax(g, { s: { buf: S }, o: { buf: P }, rows: m, n, ld: Kp, scale: 1 / Math.sqrt(C) });
      gemm(g, { w: { buf: vt, off: 0, bytes: C * Kp * 2, enc: 'f16', rows: C, cols: Kp }, x: { buf: P, ld: Kp }, M: m, N: C, K: Kp, epi: 'f16', y: { buf: o, off: r0 * C * 2, ld: C }, acc: 'f32' });
    }
    this.drop(S, P, q, k, vt);
    lin(o, p + '.to_out.0', x, true);
    this.drop(o);
    return x;
  }
  upsample(c, x, name, H, W, C) {
    const y = this.g.buffer(4 * H * W * C * 2, 'vae.up');
    this.conv(c, x, name, { Hi: H, Wi: W, Ho: 2 * H, Wo: 2 * W, up2: true, y });
    this.drop(x);
    return y;
  }
  /** up_blocks.2 upsample fused with up_blocks.3.resnets.0 by row bands (see header).  y [Hs][Ws][256] -> [2Hs][2Ws][128] */
  async bandUp3(c, y, Hs, Ws, check) {
    const g = this.g, H = 2 * Hs, W = 2 * Ws, Ci = 256, Co = 128, B = this.bandRows, up = 'decoder.up_blocks.2.upsamplers.0.conv', p = 'decoder.up_blocks.3.resnets.0';
    const ub = g.buffer((B + 2) * W * Ci * 2, 'vae.band'), s = g.buffer(H * W * Co * 2, 'vae.s'), h = g.buffer(H * W * Co * 2, 'vae.h');
    const computeU = (a, b) => {
      const sr0 = Math.max(0, Math.floor((a - 1) / 2)), sr1 = Math.min(Hs, Math.floor(b / 2) + 1);
      this.conv(c, y, up, { Hi: sr1 - sr0, Wi: Ws, Ho: b - a, Wo: W, up2: true, padT: 2 * sr0 - a + 1, padL: 1, xOff: sr0 * Ws * Ci * 2, xSize: (sr1 - sr0) * Ws * Ci * 2, y: ub });
    };
    let nwg = 0;
    for (let r0 = 0; r0 < H; r0 += B) {   // pass A: GN statistics of the whole upsampled tensor + the 1x1 shortcut
      const r1 = Math.min(H, r0 + B), rows = r1 - r0;
      computeU(r0, r1);
      nwg += gnPartial(g, { x: { buf: ub, size: rows * W * Ci * 2 }, pix: rows * W, C: Ci, part: c.part, wgOff: nwg });
      this.conv(c, ub, p + '.conv_shortcut', { Hi: rows, Wi: W, Ho: rows, Wo: W, y: s, yOff: r0 * W * Co * 2 });
      await g.done(); if (check) check();
    }
    gnFinalize(g, { part: c.part, nwg, C: Ci, gb: { buf: c.sh.buf, gOff: c.sh.t(p + '.norm1.weight').off, bOff: c.sh.t(p + '.norm1.bias').off }, ab: { buf: c.ab, off: 0 }, eps: 1e-6 });
    for (let r0 = 0; r0 < H; r0 += B) {   // pass B: recompute each band with a 1-row halo -> conv1 (GN/SiLU prologue) -> h rows
      const r1 = Math.min(H, r0 + B), a = Math.max(0, r0 - 1), b = Math.min(H, r1 + 1);
      computeU(a, b);
      this.conv(c, ub, p + '.conv1', { Hi: b - a, Wi: W, Ho: r1 - r0, Wo: W, padT: a - r0 + 1, padL: 1, gn: 0, y: h, yOff: r0 * W * Co * 2 });
      await g.done(); if (check) check();
    }
    this.drop(ub, y);
    const a2 = this.gn(c, h, H * W, Co, p + '.norm2', 1);
    this.conv(c, h, p + '.conv2', { Hi: H, Wi: W, Ho: H, Wo: W, gn: a2, y: s, res: true });
    this.drop(h);
    return s;
  }

  /** latent f32 [h*w][128] (DiT tokens) -> RGBA8 Uint8ClampedArray [16h][16w][4].  sh = the vae.dec shard handle.  opts {check, onBlock, forceBand, rgbFloat} */
  async decode(sh, latent, h, w, opts = {}) {
    const g = this.g, H8 = 2 * h, W8 = 2 * w, H = 16 * h, W = 16 * w, t = (n) => sh.t(n);
    const c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const banded = opts.forceBand != null ? opts.forceBand : H * W * 256 * 2 > this.bandAboveMB * 1e6;
    const tick = async (i) => { await g.done(); if (opts.check) opts.check(); if (opts.onBlock) opts.onBlock(i); };
    this.acc = this.picAcc || (g.tune && g.tune.vaeAcc) || 'f32';
    try {
      const z = g.buffer(H8 * W8 * 32 * 2, 'vae.z');
      layout(g, { op: 'vaeIn', n: H8 * W8 * 32, xf: { buf: latent }, v: { buf: sh.buf }, yh: { buf: z }, a: w, c: t('bn.running_mean').off / 4, d: t('bn.running_var').off / 4 });
      const z2 = g.buffer(H8 * W8 * 32 * 2, 'vae.z2');
      this.conv(c, z, 'post_quant_conv', { Hi: H8, Wi: W8, Ho: H8, Wo: W8, y: z2 }); this.drop(z);
      let x = g.buffer(H8 * W8 * 512 * 2, 'vae.x');
      this.conv(c, z2, 'decoder.conv_in', { Hi: H8, Wi: W8, Ho: H8, Wo: W8, y: x }); this.drop(z2);
      x = this.res(c, x, 'decoder.mid_block.resnets.0', 512, 512, H8, W8);
      x = this.attn(c, x, 'decoder.mid_block.attentions.0', H8, W8);
      x = this.res(c, x, 'decoder.mid_block.resnets.1', 512, 512, H8, W8);
      await tick(0);
      let Hc = H8, Wc = W8, C = 512, blk = 1;
      const chans = [512, 512, 256, 128];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          if (i === 3 && j === 0 && banded) continue;
          x = this.res(c, x, `decoder.up_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i];
          await tick(blk++);
        }
        if (i < 2 || (i === 2 && !banded)) { x = this.upsample(c, x, `decoder.up_blocks.${i}.upsamplers.0.conv`, Hc, Wc, C); Hc *= 2; Wc *= 2; await tick(blk++); }
        else if (i === 2) { x = await this.bandUp3(c, x, Hc, Wc, opts.check); Hc *= 2; Wc *= 2; C = 128; await tick(blk++); }
      }
      const ao = this.gn(c, x, H * W, 128, 'decoder.conv_norm_out', 0), rgb = g.buffer(H * W * 3 * 4, 'vae.rgb');
      convDirect(g, { x: { buf: x }, w: { buf: sh.buf, off: t('decoder.conv_out.weight').off }, f: { buf: sh.buf }, bOff: t('decoder.conv_out.bias').off / 4,
        g: { buf: c.ab }, abOff: ao, gn: true, out32: true, y: { buf: rgb }, Hi: H, Wi: W, Ci: 128, Ho: H, Wo: W, Co: 3, ks: 3, padT: 1, padL: 1 });
      this.drop(x);
      const px = g.buffer(H * W * 4, 'vae.rgba');
      layout(g, { op: 'rgba8', n: H * W, xf: { buf: rgb }, yu: { buf: px } });
      const out = { rgba: new Uint8ClampedArray(await g.read(px, 0, H * W * 4)), width: W, height: H };
      if (opts.rgbFloat) out.rgb = new Float32Array(await g.read(rgb, 0, H * W * 12));
      this.drop(rgb, px);
      return out;
    } finally { this.drop(c.ab, c.part); this.acc = 'f32'; }
  }

  /** image f16 HWC [H][W][3] in [-1, 1] (GPUBuffer) -> tokens f32 [(H/16)(W/16)][128] (BN-normalised posterior mean).
   *  sh = vae.enc shard handle; bn = a handle holding bn.running_mean / bn.running_var (vae.dec part) */
  async encode(sh, bn, img, H, W, opts = {}) {
    const g = this.g, c = { sh, ab: g.buffer(4 * 1024 * 4, 'vae.ab'), part: g.buffer(gnPartBytes(H * W), 'vae.gnpart') };
    const tick = async () => { await g.done(); if (opts.check) opts.check(); };
    try {
      let x = g.buffer(H * W * 128 * 2, 'vae.x');
      convDirect(g, { x: { buf: img }, w: { buf: sh.buf, off: sh.t('encoder.conv_in.weight').off }, f: { buf: sh.buf }, bOff: sh.t('encoder.conv_in.bias').off / 4,
        y: { buf: x }, Hi: H, Wi: W, Ci: 3, Ho: H, Wo: W, Co: 128, ks: 3, padT: 1, padL: 1 });
      let Hc = H, Wc = W, C = 128;
      const chans = [128, 256, 512, 512];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) { x = this.res(c, x, `encoder.down_blocks.${i}.resnets.${j}`, C, chans[i], Hc, Wc); C = chans[i]; await tick(); }
        if (i < 3) {
          const y = g.buffer((Hc / 2) * (Wc / 2) * C * 2, 'vae.down');
          this.conv(c, x, `encoder.down_blocks.${i}.downsamplers.0.conv`, { Hi: Hc, Wi: Wc, Ho: Hc / 2, Wo: Wc / 2, stride: 2, y });
          this.drop(x); x = y; Hc /= 2; Wc /= 2;
        }
      }
      x = this.res(c, x, 'encoder.mid_block.resnets.0', 512, 512, Hc, Wc);
      x = this.attn(c, x, 'encoder.mid_block.attentions.0', Hc, Wc);
      x = this.res(c, x, 'encoder.mid_block.resnets.1', 512, 512, Hc, Wc);
      await tick();
      const a = this.gn(c, x, Hc * Wc, 512, 'encoder.conv_norm_out', 0), y = g.buffer(Hc * Wc * 64 * 2, 'vae.y64');
      this.conv(c, x, 'encoder.conv_out', { Hi: Hc, Wi: Wc, Ho: Hc, Wo: Wc, gn: a, y }); this.drop(x);
      const q = g.buffer(Hc * Wc * 32 * 2, 'vae.q32');
      this.conv(c, y, 'quant_conv', { Hi: Hc, Wi: Wc, Ho: Hc, Wo: Wc, N: 32, y: q }); this.drop(y);
      const hw = (Hc / 2) * (Wc / 2), tok = g.buffer(hw * 128 * 4, 'vae.reftok');
      layout(g, { op: 'vaeOut', n: hw * 128, xh: { buf: q }, v: { buf: bn.buf }, yf: { buf: tok }, a: Wc / 2, b: 32, c: bn.t('bn.running_mean').off / 4, d: bn.t('bn.running_var').off / 4 });
      const out = new Float32Array(await g.read(tok, 0, hw * 128 * 4));
      this.drop(q, tok);
      return out;
    } finally { this.drop(c.ab, c.part); }
  }
}

return { vaeDecodeFlops, vaeEncodeFlops, Flux2VAE };
})();
// ---- models/gemma_te.js
__M["models/gemma_te.js"] = (() => {
// Gemma-2-2B-it text encoder for SANA-Video (SPEC video section 1-2).  Only the VALID positions are computed (pads only feed masked
// cross-attention keys, and causal attention never lets a valid token see a pad).  The fixed instruction prefix (chi prompt minus its
// trailing space, 207 tokens) is computed once: its per-layer K/V (after RoPE) and the final <bos> row are cached, so a prompt runs only
// its own tokens (attending to the cached prefix).  Output: cond f16 [300][2304] = [<bos> | positions n_chi-1 .. Lv-1 | zero rows] and
// nvalid (the cross-attention valid prefix length).  fp32 residual, f32 GEMM accumulate (text encoders need it), q8 weights.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { rowstats } = __M["ops/misc.js"];
const { attn256 } = __M["ops/video.js"];
const { rmshead, normadd, rmsrow32, ropeGemma } = __M["ops/video2.js"];
const { Tokenizer } = __M["vendor/tokenizers.min.mjs"];
const D = 2304, L = 26, HQ = 8, HKV = 4, HD = 256, MLP = 9216;

class GemmaTE {
  constructor(gpu, store) { this.g = gpu; this.store = store; this.cfg = store.m.model.te; this.cache = null; this.tok = null; }
  async loadTokenizer() {
    if (this.tok) return this.tok;
    const d = new TextDecoder(), rd = async (n) => JSON.parse(d.decode(await this.store.readFile(n)));
    this.tok = new Tokenizer(await rd('tokenizer.tokenizer'), await rd('tokenizer.tokenizer_config'));
    this.chiIds = this.tok.encode(this.cfg.chi_prompt).ids;
    return this.tok;
  }
  /** -> {ids (valid positions only), Lv, nChi, P (cacheable prefix), nvalid} */
  async tokenize(prompt) {
    const tok = await this.loadTokenizer(), c = this.cfg, text = c.chi_prompt + String(prompt).trim() + c.prompt_suffix;
    const nChi = this.chiIds.length, maxLen = nChi + c.max_extra_tokens;
    const ids = tok.encode(text).ids.slice(0, maxLen), Lv = ids.length;
    let P = nChi - 1; for (let i = 0; i < P; i++) if (ids[i] !== this.chiIds[i]) { P = 0; break; }
    return { ids, Lv, nChi, P, nvalid: Math.max(1, Math.min(c.cond_tokens, Lv - nChi + 2)), truncated: tok.encode(text).ids.length > maxLen };
  }

  /** run layers over rows [P, Lv) (P = 0: no cache).  capture: build the prefix cache (K/V of all rows + final row 0) */
  async _run(ids, P, Lv, opts = {}) {
    const g = this.g, st = this.store, M = Lv - P, capture = !!opts.capture;
    const uniq = Array.from(new Set(ids.slice(P))), rows = await st.readRows('model.embed_tokens.weight', uniq);
    const where = new Map(uniq.map((id, i) => [id, i])), x0 = new Float32Array(M * D), sc = Math.fround(this.cfg.embed_scale);
    for (let t = 0; t < M; t++) { const r = where.get(ids[P + t]) * D; for (let c = 0; c < D; c++) x0[t * D + c] = Math.fround(rows[r + c] * sc); }
    const B = [], buf = (n, l) => { const b = g.buffer(n, l); B.push(b); return b; };
    const s = { x: g.upload(x0, 'gte.x'), stats: buf(M * 8, 'gte.st'), qkv: buf(M * 4096 * 2, 'gte.qkv'), heads: buf(16 * Lv * 512, 'gte.heads'),
      o: buf(Lv * 2048 * 2, 'gte.o'), t: buf(M * D * 4, 'gte.t'), m: buf(M * MLP * 2, 'gte.m'), rope: g.upload(ropeGemma(Lv), 'gte.rope') };
    B.push(s.x, s.rope);
    const kvBytes = HKV * P * 512, cache = capture ? g.buffer(L * 2 * HKV * Lv * 512, 'gte.cache') : null;
    let sh = null;
    try {
      sh = await st.upload('te.layer.00');
      for (let l = 0; l < L; l++) {
        const p = `model.layers.${l}.`, t = (n) => sh.t(p + n);
        if (P && !capture) {   // the cached prefix K/V of this layer -> rows [0, P) of the K and V sections
          for (let kv = 0; kv < 2; kv++) for (let h = 0; h < HKV; h++)
            g.runner.copy(this.cache.kv, ((l * 2 + kv) * HKV + h) * P * 512, s.heads, ((8 + kv * 4 + h) * Lv) * 512, P * 512);
        }
        rowstats(g, { x: { buf: s.x }, rows: M, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
        gemm(g, { acc: 'f32', w: t('self_attn.qkv_proj.weight'), x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: t('input_layernorm.weight').off / 4 },
          M, N: 4096, K: D, epi: 'f16', y: { buf: s.qkv, ld: 4096 } });
        const rope = { buf: s.rope };
        rmshead(g, { M, D: 2048, hd: HD, x: { buf: s.qkv, ld: 4096, c0: 0 }, rope, out: { buf: s.heads, off: 0 }, Ltot: Lv, rowOff: P });
        rmshead(g, { M, D: 1024, hd: HD, x: { buf: s.qkv, ld: 4096, c0: 2048 }, rope, out: { buf: s.heads, off: 8 * Lv * 512 }, Ltot: Lv, rowOff: P });
        rmshead(g, { M, D: 1024, hd: HD, x: { buf: s.qkv, ld: 4096, c0: 3072 }, out: { buf: s.heads, off: 12 * Lv * 512 }, Ltot: Lv, rowOff: P });
        if (capture) for (let kv = 0; kv < 2; kv++) g.runner.copy(s.heads, (8 + kv * 4) * Lv * 512, cache, (l * 2 + kv) * HKV * Lv * 512, HKV * Lv * 512);
        attn256(g, { q: { buf: s.heads, off: 0 }, k: { buf: s.heads, off: 8 * Lv * 512 }, v: { buf: s.heads, off: 12 * Lv * 512 }, o: { buf: s.o, ld: 2048 },
          Lq: Lv, Lk: Lv, Hq: HQ, Hkv: HKV, mode: 1, nvalid: Lv, cap: this.cfg.attn_softcap, scale: this.cfg.attn_scale });
        gemm(g, { acc: 'f32', w: t('self_attn.o_proj.weight'), x: { buf: s.o, off: P * 4096, ld: 2048 }, M, N: D, K: 2048, epi: 'f32', y: { buf: s.t, ld: D } });
        normadd(g, { M, D, t: { buf: s.t }, w: { buf: sh.buf, off: t('post_attention_layernorm.weight').off / 4 }, x: { buf: s.x } });
        rowstats(g, { x: { buf: s.x }, rows: M, cols: D, mode: 'rms', eps: 1e-6, st: { buf: s.stats } });
        gemm(g, { acc: 'f32', w: t('mlp.gate_up_proj.weight'), x: { buf: s.x, ld: D, mode: 'rms' }, stats: { buf: s.stats }, pv: { buf: sh.buf, off: t('pre_feedforward_layernorm.weight').off / 4 },
          M, N: 2 * MLP, K: D, wr0: 0, wr1: MLP, epi: 'swiglu', act: 'gelu', y: { buf: s.m, ld: MLP } });
        gemm(g, { acc: 'f32', w: t('mlp.down_proj.weight'), x: { buf: s.m, ld: MLP }, M, N: D, K: MLP, epi: 'f32', y: { buf: s.t, ld: D } });
        normadd(g, { M, D, t: { buf: s.t }, w: { buf: sh.buf, off: t('post_feedforward_layernorm.weight').off / 4 }, x: { buf: s.x } });
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        st.release(sh);
        sh = await st.upload(l + 1 < L ? 'te.layer.' + String(l + 1).padStart(2, '0') : 'te.final');
        await done;
        if (opts.check) opts.check();
        if (opts.onLayer) opts.onLayer(l);
      }
      return { x: s.x, final: sh, cache, free: () => { g.runner.flush(); for (const b of B) g.free(b); st.release(sh); } };
    } catch (e) { g.runner.flush(); for (const b of B) g.free(b); if (sh) st.release(sh); if (cache) g.free(cache); throw e; }
  }

  async _buildCache(P, opts) {
    const g = this.g, r = await this._run(this.chiIds.slice(0, P), 0, P, Object.assign({}, opts, { capture: true }));
    const bos = g.buffer(D * 2, 'gte.bos');
    rmsrow32(g, { M: 1, D, x: { buf: r.x }, w: { buf: r.final.buf, off: r.final.t('model.norm.weight').off / 4 }, out: { buf: bos, ld: D } });
    await g.done(); r.free();
    this.cache = { P, kv: r.cache, bos };
  }

  /** -> {cond: GPUBuffer f16 [300][2304], nvalid, Lv, P} */
  async encode(prompt, opts = {}) {
    const g = this.g, tk = await this.tokenize(prompt), C = this.cfg.cond_tokens;
    let P = tk.P;
    if (P && (!this.cache || this.cache.P !== P)) { if (this.cache) this.freeCache(); await this._buildCache(P, opts); }
    const r = await this._run(tk.ids, P, tk.Lv, opts);
    const cond = g.buffer(C * D * 2, 'cond');
    try {
      const w = { buf: r.final.buf, off: r.final.t('model.norm.weight').off / 4 }, first = tk.nChi - 1, n = tk.nvalid - 1;   // rows 1.. = positions nChi-1 .. Lv-1
      if (P) g.runner.copy(this.cache.bos, 0, cond, 0, D * 2);
      else rmsrow32(g, { M: 1, D, x: { buf: r.x }, w, out: { buf: cond, ld: D, row: 0 } });
      if (n > 0) rmsrow32(g, { M: n, D, x: { buf: r.x, off: (first - P) * D * 4 }, w, out: { buf: cond, ld: D, row: 1 } });
      await g.done();
    } finally { r.free(); }
    this.tok = null;   // the parsed Gemma tokenizer is ~160 MB of JS heap (iOS counts it against the page): rebuilt for the next new prompt
    return { cond, nvalid: tk.nvalid, Lv: tk.Lv, P, truncated: tk.truncated };
  }
  freeCache() { if (this.cache) { this.g.runner.flush(); this.g.free(this.cache.kv); this.g.free(this.cache.bos); this.cache = null; } }
}

return { GemmaTE };
})();
// ---- models/sana_dit.js
__M["models/sana_dit.js"] = (() => {
// SANA-Video 2.0 5B DiT + the FastVideo DMD 4-step sampler (SPEC video sections 3-4), streamed one 86 MB block shard at a time.
// Inference path of SanaVideo2._forward_attn_res_inference: depth aggregation ("attention residual") over f16 sources
// [x_embed | group 1..4 | partial], fp32 partial sums, gated linear attention (24 blocks) / 10x256 softmax anchors (8 blocks),
// masked cross-attention to the 300 caption tokens, biased SwiGLU MLP; final layer modulated by (table + t), not t0.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { attention } = __M["ops/attention.js"];
const { rowstats, ew, layout } = __M["ops/misc.js"];
const { laprep, kvstate, attn256, attnres } = __M["ops/video.js"];
const { rmshead, vop, ropeWan } = __M["ops/video2.js"];
const { toF16 } = __M["core/gpu.js"];
const D = 2560, MLP = 10240, MODN = 6 * D, LDG = 2624, f = Math.fround, neg = (n) => (-n) >>> 0;

/** SANA TimestepEmbedder.timestep_embedding(t, 256): [cos | sin](t * exp(-ln(1e4) k / 128)), float32 like torch */
function sanaTimeEmb(t) {
  const e = new Float32Array(256), c = f(-Math.log(10000));
  for (let k = 0; k < 128; k++) { const fr = f(Math.exp(f(f(c * k) / 128))), a = f(t * fr); e[k] = Math.cos(a); e[128 + k] = Math.sin(a); }
  return e;
}
const sanaStepFlops = (N) => 2 * N * 4.40e9 + 8 * 4 * N * N * 256 * 10 + 32 * 2 * 300 * 2560 * 5120;

class SanaDiT {
  constructor(gpu, store, opts = {}) { this.g = gpu; this.store = store; this.cfg = store.m.model.dit; this.chunk = opts.chunk || 1024; this.acc = opts.acc || null; }

  /** cond {cond: f16 [300][2304], nvalid}; latent grid T x H x W -> state (per-prompt y, per-step modulation, per-size RoPE + scratch) */
  async prepare(cond, T, H, W) {
    const g = this.g, st = this.store, c = this.cfg, steps = c.timesteps.length, N = T * H * W, S = { T, H, W, N, steps, nvalid: cond.nvalid, bufs: [] };
    const B = (n, l) => { const b = g.buffer(n, l); S.bufs.push(b); return b; };
    try {
      const gl = await st.upload('dit.global'), t = (n) => gl.t(n), tmp = [];
      const tb = (n) => { const b = g.buffer(n); tmp.push(b); return b; };
      try {
        // caption: y = RMSNorm(fc2(gelu(fc1(cond)))) * w   (kept as f16 [300][2560])
        const y1 = tb(300 * D * 2), y2 = tb(300 * D * 2);
        gemm(g, { acc: 'f32', w: t('y_embedder.y_proj.fc1.weight'), x: { buf: cond.cond, ld: 2304 }, M: 300, N: D, K: 2304, epi: 'bias', ev: { buf: gl.buf, off: t('y_embedder.y_proj.fc1.bias').off / 4 }, y: { buf: y1, ld: D } });
        ew(g, { op: 'gelu', n: 300 * D, B: { buf: y1 } });
        gemm(g, { acc: 'f32', w: t('y_embedder.y_proj.fc2.weight'), x: { buf: y1, ld: D }, M: 300, N: D, K: D, epi: 'bias', ev: { buf: gl.buf, off: t('y_embedder.y_proj.fc2.bias').off / 4 }, y: { buf: y2, ld: D } });
        S.y = B(300 * D * 2, 'dit.y');
        rmshead(g, { M: 300, D, x: { buf: y2, ld: D }, w: { buf: gl.buf, off: t('attention_y_norm.weight').off / 4 }, eps: 1e-5, tok: { ld: D }, out: { buf: S.y } });
        // time: t = mlp(emb(ts)) (f16 [steps][2560]); t0 = t_block(silu(t)) (f16 [steps][15360]); final [shift | scale] = table + t (f32)
        const E = new Float32Array(steps * 256); c.timesteps.forEach((ts, k) => E.set(sanaTimeEmb(ts), k * 256));
        const e16 = g.upload(toF16(E)); tmp.push(e16);
        const h1 = tb(steps * D * 2), tsil = tb(steps * D * 2);
        gemm(g, { acc: 'f32', w: t('t_embedder.mlp.0.weight'), x: { buf: e16, ld: 256 }, M: steps, N: D, K: 256, epi: 'bias', ev: { buf: gl.buf, off: t('t_embedder.mlp.0.bias').off / 4 }, y: { buf: h1, ld: D } });
        ew(g, { op: 'silu', n: steps * D, B: { buf: h1 } });
        S.t = B(steps * D * 2, 'dit.t');
        gemm(g, { acc: 'f32', w: t('t_embedder.mlp.2.weight'), x: { buf: h1, ld: D }, M: steps, N: D, K: D, epi: 'bias', ev: { buf: gl.buf, off: t('t_embedder.mlp.2.bias').off / 4 }, y: { buf: S.t, ld: D } });
        g.runner.copy(S.t, 0, tsil, 0, steps * D * 2);
        ew(g, { op: 'silu', n: steps * D, B: { buf: tsil } });
        S.t0 = B(steps * MODN * 2, 'dit.t0');
        gemm(g, { acc: 'f32', w: t('t_block.1.weight'), x: { buf: tsil, ld: D }, M: steps, N: MODN, K: D, epi: 'bias', ev: { buf: gl.buf, off: t('t_block.1.bias').off / 4 }, y: { buf: S.t0, ld: MODN } });
        S.fin = B(steps * 2 * D * 4, 'dit.finmod');
        for (let k = 0; k < steps; k++) vop(g, { op: 'addvec', n: 2 * D, af: { buf: gl.buf }, a: t('final_layer.scale_shift_table').off / 4, ah: { buf: S.t }, b: k * D, c: D, yf: { buf: S.fin, off: k * 2 * D * 4 } });
        S.keep = await st.uploadPart('dit.global', ['x_embedder.proj.weight', 'x_embedder.proj.bias', 'final_layer.linear.weight', 'final_layer.linear.bias',
          'attn_res.attn_proj.weight', 'attn_res.mlp_proj.weight', 'attn_res.final_proj.weight']);
        S.bufs.push(S.keep.buf);
        await g.done();
      } finally { st.release(gl); g.runner.flush(); tmp.forEach((b) => g.free(b)); }
      S.rope1 = B(N * 64 * 8, 'dit.rope128'); g.upload(ropeWan(T, H, W, c.rope_pairs_128), '', S.rope1);
      S.rope2 = B(N * 128 * 8, 'dit.rope256'); g.upload(ropeWan(T, H, W, c.rope_pairs_256), '', S.rope2);
      // memory plan: qkv scratch (3 N D f16) is dead after laprep -> reused as [O | x16 | QC]; the head-major QH (3 N D f16) is dead after the
      // attention read-out -> reused for the fp32 delta (N D f32).  Peak at 736x1280 (N = 10120) ~1.15 GB incl. two block shards.
      S.src = B(6 * N * D * 2, 'dit.sources'); S.hidden = B(N * D * 4, 'dit.hidden'); S.partial = B(N * D * 4, 'dit.partial');
      S.stats = B(N * 8, 'dit.stats'); S.qkv = B(N * 3 * D * 2, 'dit.qkv|o|x16|qc'); S.G = B(N * LDG * 2, 'dit.gate'); S.QH = B(N * 3 * D * 2, 'dit.qh|delta');
      S.kvc = B(300 * 2 * D * 2, 'dit.kvc'); S.KC = B(300 * D * 2, 'dit.kc'); S.VC = B(300 * D * 2, 'dit.vc');
      S.m = B(this.chunk * MLP * 2, 'dit.mlp'); S.mod = B(MODN * 4, 'dit.mod'); S.KV = B(20 * 128 * 128 * 2, 'dit.kv');
      S.splits = Math.max(1, Math.min(64, Math.ceil(N / 512))); S.part = B(S.splits * 20 * 65536, 'dit.kvpart');
      S.tok = B(N * 128 * 2, 'dit.tok16'); S.v = B(N * 128 * 4, 'dit.v');
    } catch (e) { this.free(S); throw e; }
    return S;
  }

  _block(S, sh, b, k, first, active) {
    const g = this.g, N = S.N, p = `blocks.${b}.`, t = (n) => sh.t(p + n), lin = !this.cfg.anchors.includes(b);
    const acc = this.acc || (g.tune && g.tune.acc) || 'f32', bias = (n) => ({ buf: sh.buf, off: t(n).off / 4 }), K = S.keep;
    // per-class accumulate (precision audit): the caption kv projection always accumulates in f32 (f16 partial sums there move the
    // final latent 3.6e-2 -> 4.4e-3 when fixed; 300 rows, ~0.2 s per step on a phone); everything else follows the device tune
    const ac = (cls) => (g.tune && g.tune.accClass && g.tune.accClass[cls]) || (cls === 'crosskv' ? 'f32' : acc);
    // aliases (no dispatch ever binds one buffer twice with a write):  A = qkv scratch, B = QH
    //   O = A[0] (attention output), X16 = A[1] (cross input), QC = A[2] (cross q heads); DL = B[0..2) (f32 delta), OCQ = B[2] (q_linear out), OC = B[0] (cross output)
    const slot = (i) => ({ buf: S.src, off: i * N * D * 2 }), R1 = N * D * 2;
    const O = { buf: S.qkv, off: 0 }, X16 = { buf: S.qkv, off: R1 }, QC = { buf: S.qkv, off: 2 * R1 }, DL = { buf: S.QH, off: 0 }, OCQ = { buf: S.QH, off: 2 * R1 }, OC = { buf: S.QH, off: 0 };
    const castPartial = () => layout(g, { op: 'cast2d', n: N * D, xf: { buf: S.partial }, yh: slot(active), a: D, b: D, c: 0, d: D, e: 0 });
    const aggregate = (proj, ns) => attnres(g, { src: { buf: S.src }, q: { buf: K.buf, off: K.t('attn_res.' + proj + '.weight').off / 4 }, out: { buf: S.hidden }, N, D, ns });
    vop(g, { op: 'addvec', n: MODN, af: { buf: sh.buf }, a: t('scale_shift_table').off / 4, ah: { buf: S.t0 }, b: k * MODN, c: MODN, yf: { buf: S.mod } });
    // ---- attention sublayer: hidden = aggregate(sources [+ partial]); delta = gate_msa * proj(attn(LN(hidden)(1+scale)+shift)) + ...
    if (!first) castPartial();
    aggregate('attn_proj', first ? active : active + 1);
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    const lnx = { buf: S.hidden, ld: D, mode: 'lnmod' }, lnp = { buf: S.mod, off: D, stride: neg(D) };
    gemm(g, { acc: ac('qkv'), w: t('attn.qkv.weight'), x: lnx, stats: { buf: S.stats }, pv: lnp, M: N, N: 3 * D, K: D, epi: 'f16', y: { buf: S.qkv, ld: 3 * D } });
    gemm(g, { acc: ac('gate'), w: t('attn.output_gate.weight'), x: lnx, stats: { buf: S.stats }, pv: lnp, M: N, N: D, K: D, epi: 'bias', ev: bias('attn.output_gate.bias'), y: { buf: S.G, ld: LDG } });
    const qkw = { buf: sh.buf, off: t('attn.q_norm.weight').off };
    if (t('attn.k_norm.weight').off !== qkw.off + D * 4) throw new Error('pack: q_norm / k_norm must be adjacent');
    if (lin) {
      const bw = t('attn.beta_proj.weight');
      gemm(g, { acc: ac('gate'), w: Object.assign({}, bw, { rows: 20, cols: D }), x: lnx, stats: { buf: S.stats }, pv: lnp, M: N, N: 20, K: D, epi: 'bias', ev: bias('attn.beta_proj.bias'), y: { buf: S.G, ld: LDG, n0: D } });
      laprep(g, { N, D, hd: 128, qkv: { buf: S.qkv }, g: { buf: S.G, ld: LDG, off: D }, w: qkw, rope: { buf: S.rope1 }, out: { buf: S.QH }, eps: 1e-5 });
      kvstate(g, { N, H: 20, qkvh: { buf: S.QH }, kv: { buf: S.KV }, part: S.part, splits: S.splits });
      for (let h = 0; h < 20; h++) gemm(g, { acc: 'f32', w: { buf: S.KV, off: h * 32768, bytes: 32768, enc: 'f16', rows: 128, cols: 128 }, x: { buf: S.QH, off: h * N * 256, ld: 128 },
        M: N, N: 128, K: 128, epi: 'onormgate', ev: bias('attn.o_norm.weight'), gt: { buf: S.G }, heads: { Ltot: LDG, eps: 1e-5 / (N * N) }, y: { buf: O.buf, off: 0, ld: D, n0: h * 128 } });
    } else {
      laprep(g, { N, D, hd: 256, qkv: { buf: S.qkv }, w: qkw, rope: { buf: S.rope2 }, out: { buf: S.QH }, eps: 1e-5 });
      attn256(g, { q: { buf: S.QH, off: 0 }, k: { buf: S.QH, off: 10 * N * 512 }, v: { buf: S.QH, off: 20 * N * 512 }, o: { buf: O.buf, off: 0, ld: D }, Lq: N, Lk: N, Hq: 10, Hkv: 10, mode: 0, scale: 1 / 16 });
      vop(g, { op: 'mulsig', n: N * D / 2, yu: { buf: O.buf, off: 0, size: R1 }, ah: { buf: S.G }, a: D, b: LDG });
    }
    gemm(g, { acc: ac('proj'), w: t('attn.proj.weight'), x: { buf: O.buf, off: 0, size: R1, ld: D }, M: N, N: D, K: D, epi: 'resadd', store: true, ev: { buf: S.mod, off: 2 * D }, bv: bias('attn.proj.bias'), y: { buf: DL.buf, off: 0, ld: D } });
    vop(g, { op: 'add32', n: N * D, af: { buf: DL.buf, off: 0, size: N * D * 4 }, yf: { buf: S.partial }, a: first ? 1 : 0 });
    // ---- cross-attention on hidden + delta (caption keys masked to the valid prefix)
    vop(g, { op: 'add16', n: N * D / 2, af: { buf: S.hidden }, bf: { buf: DL.buf, off: 0, size: N * D * 4 }, yu: { buf: X16.buf, off: X16.off, size: R1 } });
    gemm(g, { acc: ac('crossq'), w: t('cross_attn.q_linear.weight'), x: { buf: X16.buf, off: X16.off, size: R1, ld: D }, M: N, N: D, K: D, epi: 'bias', ev: bias('cross_attn.q_linear.bias'), y: { buf: OCQ.buf, off: OCQ.off, size: R1, ld: D } });
    rmshead(g, { M: N, D, hd: 128, x: { buf: OCQ.buf, off: OCQ.off, ld: D }, w: { buf: sh.buf, off: t('cross_attn.q_norm.weight').off / 4 }, eps: 1e-6, out: { buf: QC.buf, off: QC.off }, Ltot: N });
    gemm(g, { acc: ac('crosskv'), w: t('cross_attn.kv_linear.weight'), x: { buf: S.y, ld: D }, M: 300, N: 2 * D, K: D, epi: 'bias', ev: bias('cross_attn.kv_linear.bias'), y: { buf: S.kvc, ld: 2 * D } });
    rmshead(g, { M: 300, D, hd: 128, x: { buf: S.kvc, ld: 2 * D, c0: 0 }, w: { buf: sh.buf, off: t('cross_attn.k_norm.weight').off / 4 }, eps: 1e-6, out: { buf: S.KC }, Ltot: 300 });
    rmshead(g, { M: 300, D, hd: 128, x: { buf: S.kvc, ld: 2 * D, c0: D }, out: { buf: S.VC }, Ltot: 300 });
    attention(g, { q: { buf: QC.buf, off: QC.off, size: R1 }, k: { buf: S.KC }, v: { buf: S.VC }, o: { buf: OC.buf, off: 0, size: R1, ld: D }, Lq: N, Lk: 300, Hq: 20, Hkv: 20, mode: 2, nvalid: S.nvalid,
      cfg: { BQ: 64, sg: false, pv16: true } });
    gemm(g, { acc: ac('crossproj'), w: t('cross_attn.proj.weight'), x: { buf: OC.buf, off: 0, size: R1, ld: D }, M: N, N: D, K: D, epi: 'resadd', bv: bias('cross_attn.proj.bias'), y: { buf: S.partial, ld: D } });
    // ---- MLP sublayer: hidden = aggregate(sources + partial); partial += gate_mlp * down(silu(gate(u)) * up(u)), u = LN(hidden)(1+scale)+shift
    castPartial();
    aggregate('mlp_proj', active + 1);
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    for (let r = 0; r < N; r += this.chunk) {
      const n = Math.min(this.chunk, N - r);
      gemm(g, { acc: ac('up'), w: t('mlp.gate_up_proj.weight'), x: { buf: S.hidden, off: r * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: S.stats, off: r }, pv: { buf: S.mod, off: 4 * D, stride: neg(D) },
        M: n, N: 2 * MLP, K: D, wr0: 0, wr1: MLP, epi: 'swiglu', bv: { buf: sh.buf, off: t('mlp.gate_up_proj.bias').off / 4, up: MLP }, y: { buf: S.m, ld: MLP } });
      gemm(g, { acc: ac('down'), w: t('mlp.down_proj.weight'), x: { buf: S.m, ld: MLP }, M: n, N: D, K: MLP, epi: 'resadd', ev: { buf: S.mod, off: 5 * D }, bv: bias('mlp.down_proj.bias'), y: { buf: S.partial, off: r * D * 4, ld: D } });
    }
  }

  /** one DMD step k on latent tokens (f32 [N][128], in place): v = DiT(x, t_k); x = (1 - s') (x - s v) + s' noise (last step: x - s v).
   *  noise: f32 tokens buffer or null on the last step.  opts {onBlock(i), check(), keepVelocity} */
  async step(S, k, latent, noise, opts = {}) {
    const g = this.g, st = this.store, N = S.N, K = S.keep, c = this.cfg;
    layout(g, { op: 'cast16', n: N * 128, xf: { buf: latent }, yh: { buf: S.tok } });
    gemm(g, { acc: 'f32', w: K.t('x_embedder.proj.weight'), x: { buf: S.tok, ld: 128 }, M: N, N: D, K: 128, epi: 'bias', ev: { buf: K.buf, off: K.t('x_embedder.proj.bias').off / 4 }, y: { buf: S.src, ld: D } });
    let active = 1, sh = await st.upload('dit.block.00');
    try {
      for (let b = 0; b < c.depth; b++) {
        const first = b % c.attn_res_block === 0;
        this._block(S, sh, b, k, first, active);
        if (b % c.attn_res_block === c.attn_res_block - 1) {   // group end: the partial becomes a source
          layout(g, { op: 'cast2d', n: N * D, xf: { buf: S.partial }, yh: { buf: S.src, off: active * N * D * 2 }, a: D, b: D, c: 0, d: D, e: 0 });
          active++;
        }
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        st.release(sh);
        if (b + 1 < c.depth) sh = await st.upload('dit.block.' + String(b + 1).padStart(2, '0'));
        await done;
        if (opts.check) opts.check();
        if (opts.onBlock) opts.onBlock(b);
      }
    } finally { if (sh) st.release(sh); }
    attnres(g, { src: { buf: S.src }, q: { buf: K.buf, off: K.t('attn_res.final_proj.weight').off / 4 }, out: { buf: S.hidden }, N, D, ns: active });
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    gemm(g, { acc: 'f32', w: K.t('final_layer.linear.weight'), x: { buf: S.hidden, ld: D, mode: 'lnmod' }, stats: { buf: S.stats }, pv: { buf: S.fin, off: k * 2 * D + D, stride: neg(D) },
      M: N, N: 128, K: D, epi: 'resadd', store: true, bv: { buf: K.buf, off: K.t('final_layer.linear.bias').off / 4 }, y: { buf: S.v, ld: 128 } });
    const s = c.sigmas[k], s2 = k + 1 < c.sigmas.length ? c.sigmas[k + 1] : 0;
    if (opts.keepVelocity) opts.keepVelocity.push(new Float32Array(await g.read(S.v)));
    vop(g, { op: 'dmd', n: N * 128, yf: { buf: latent }, af: { buf: S.v }, bf: noise && s2 > 0 ? { buf: noise } : null, s0: s, s1: s2 > 0 ? f(1 - s2) : 1, s2: s2 > 0 ? s2 : 0 });
    await g.done();
  }
  free(S) { this.g.runner.flush(); for (const b of S.bufs || []) this.g.free(b); S.bufs = []; }
}

return { sanaTimeEmb, sanaStepFlops, SanaDiT };
})();
// ---- models/ltx2_vae.js
__M["models/ltx2_vae.js"] = (() => {
// LTX-2.3 video decoder (diffusers AutoencoderKLLTX2Video.decoder, decoder_causal false) on f16 THWC tensors, under an explicit GPU
// memory budget (the phone: ~0.5 GB alive during decode).  Two-level tiling, FULL time extent everywhere:
//  - big tiles (4 latent px overlap per interior side, hard centre crop; SPEC video 5: max 6/255 vs untiled) run conv_in .. up_blocks.2;
//    their peak is the up_blocks.1/2 stages at ~131 KB x T' per latent px;
//  - up_blocks.3 (the 8x-resolution stage, 2x that peak) runs on EXACT sub-tiles of the big tile's up_blocks.2 output: a 6-px halo (in
//    4x-latent px) covers the whole receptive field of up_blocks.3 + conv_out (5.5 px), so sub-tiling there changes nothing.
// Each finished sub-tile core is read back as RGBA and handed to `sink` (frames are assembled outside the GPU, e.g. in an OPFS file).
// No GroupNorm: PixelNorm + SiLU fused into the consuming conv's prologue, residuals into the epilogue, time padding replicate.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { pixstats, d2s } = __M["ops/video.js"];
const { vop } = __M["ops/video2.js"];
const ltxFlopsPerPixelFrame = 115e3;   // ~79 TFLOP for 81 x 480 x 832 (untiled)
const HALO3 = 6;                              // up_blocks.3 sub-tile halo in 4x-latent px (receptive field 5.5)

/** tile grid over an h x w grid with `ov` px overlap per interior side, minimising total tile area with every tile <= maxArea */
function planTiles(h, w, maxArea, ov = 4) {
  let best = null;
  const cut = (n, k) => Array.from({ length: k + 1 }, (_, i) => Math.round((i * n) / k));
  for (let ny = 1; ny <= h; ny++) for (let nx = 1; nx <= w; nx++) {
    const ys = cut(h, ny), xs = cut(w, nx), tiles = []; let maxA = 0, tot = 0;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const t = { y0: Math.max(0, ys[i] - ov), y1: Math.min(h, ys[i + 1] + ov), x0: Math.max(0, xs[j] - ov), x1: Math.min(w, xs[j + 1] + ov), cy0: ys[i], cy1: ys[i + 1], cx0: xs[j], cx1: xs[j + 1] };
      const a = (t.y1 - t.y0) * (t.x1 - t.x0); maxA = Math.max(maxA, a); tot += a; tiles.push(t);
    }
    if (maxA <= maxArea && (!best || tot < best.tot)) best = { tot, tiles, ny, nx, maxA };
    if (best && ny * nx > 4 * best.tiles.length) break;
  }
  return best;
}

/** split an H x W core into ny x nx sub-cores so that every core + `halo` on ALL sides fits maxArea (minimum total work) */
function planSub(H, W, maxArea, halo) {
  let best = null;
  for (let ny = 1; ny <= H; ny++) for (let nx = 1; nx <= W; nx++) {
    const a = (Math.ceil(H / ny) + 2 * halo) * (Math.ceil(W / nx) + 2 * halo);
    if (a <= maxArea && (!best || ny * nx * a < best.tot)) best = { ny, nx, tot: ny * nx * a };
  }
  if (!best) return null;
  const cut = (n, k) => Array.from({ length: k + 1 }, (_, i) => Math.round((i * n) / k)), ys = cut(H, best.ny), xs = cut(W, best.nx), tiles = [];
  for (let i = 0; i < best.ny; i++) for (let j = 0; j < best.nx; j++) tiles.push({ cy0: ys[i], cy1: ys[i + 1], cx0: xs[j], cx1: xs[j + 1] });
  return { tiles, ny: best.ny, nx: best.nx };
}

class LTX2Decoder {
  constructor(gpu, store, opts = {}) {
    this.g = gpu; this.store = store; this.cfg = store.m.model.vae; this.budget = opts.budgetBytes || 1.2e9; this.acc = opts.acc || null;
    this.sliceBytes = opts.sliceBytes || 4e6; this.jsBytes = 0;
    this.chunk = opts.chunk != null ? opts.chunk : 1;   // p0pc0rn v029: frames per time chunk (0 = the v028 decoder: two whole tensors per stage)
    this.forcePlan = opts.plan || null;                 // test tools: {maxBig, maxSub4} instead of the budget's plan
  }
  frames(T) { return (T - 1) * this.cfg.t_compress + 1; }
  /** big tiles (latent px) + the up_blocks.3 sub-tile size limit (4x-latent px^2) from the budget */
  plan(T, h, w) {
    if (this.forcePlan) { const big = planTiles(h, w, this.forcePlan.maxBig); if (big) big.maxSub4 = this.forcePlan.maxSub4; return big; }
    if (this.chunk) return this._planC(T, h, w);
    const B = this.budget, wts = 120e6, misc = 25e6;   // wts: the up_blocks.1 shard, alive at the big-tile peak
    const maxBig = Math.max(16, Math.floor((B - wts - misc) / (131072 * T * 1.1)));
    const big = planTiles(h, w, maxBig);
    if (!big) return null;
    const availSub = B - 65536 * T * 1.1 * big.maxA - 12e6 - misc;
    big.maxSub4 = Math.max(16 * 16, Math.floor(availSub / ((262144 * T / 16) * 1.15)));
    return big;
  }
  conv(sh, name, x, Cout, o = {}) {
    const w = sh.t(name + '.weight'), b = { buf: sh.buf, off: sh.t(name + '.bias').off / 4 };
    gemm(this.g, { acc: this.acc || (this.g.tune && this.g.tune.vaeAcc) || 'f32', w, x: { buf: x.buf }, M: x.T * x.H * x.W, N: Cout, K: 27 * x.C,
      epi: o.out32 ? 'resadd' : 'bias', store: !!o.out32, ev: o.out32 ? undefined : b, bv: o.out32 ? b : undefined, res: !!o.res,
      stats: o.pn ? { buf: o.pn } : undefined, y: { buf: o.y },
      conv: { kind: 'conv3', Hi: x.H, Wi: x.W, Ci: x.C, Ho: x.H, Wo: x.W, stride: x.T, pn: !!o.pn } });
  }
  drop(...bs) { this.g.runner.flush(); for (const b of bs) if (b) this.g.free(b); }
  /** cancel point: drain the queue (destruction becomes real, a pending abort is seen within one ResBlock) */
  async tick(opts) { this.g.runner.flush(); await this.g.device.queue.onSubmittedWorkDone(); if (opts && opts.check) opts.check(); }
  async res(sh, pre, x, n, R, opts) {
    const g = this.g;
    for (let r = 0; r < n; r++) {
      const V = x.T * x.H * x.W, hb = g.buffer(V * x.C * 2, 'vae.h');
      pixstats(g, { x: { buf: x.buf }, r: { buf: R }, V, C: x.C });
      this.conv(sh, `${pre}.resnets.${r}.conv1.conv`, x, x.C, { pn: R, y: hb });
      pixstats(g, { x: { buf: hb }, r: { buf: R }, V, C: x.C });
      this.conv(sh, `${pre}.resnets.${r}.conv2.conv`, { buf: hb, T: x.T, H: x.H, W: x.W, C: x.C }, x.C, { pn: R, y: x.buf, res: true });
      this.drop(hb);
      await this.tick(opts);
    }
  }
  /** upsampler conv -> depth-to-space (first p1-1 frames dropped); frees x */
  upsample(sh, name, x, ch, up) {
    const g = this.g, [p1, p2, p3] = up, c = g.buffer(x.T * x.H * x.W * ch * p1 * p2 * p3 * 2, 'vae.upconv');
    this.conv(sh, name, x, ch * p1 * p2 * p3, { y: c });
    this.drop(x.buf);
    const To = x.T * p1 - (p1 - 1), Ho = x.H * p2, Wo = x.W * p3, y = g.buffer(To * Ho * Wo * ch * 2, 'vae.x');
    d2s(g, { x: { buf: c }, y: { buf: y }, T: x.T, H: x.H, W: x.W, C: ch, p1, p2, p3 });
    this.drop(c);
    return { buf: y, T: To, H: Ho, W: Wo, C: ch };
  }

  // ---- p0pc0rn v029: the TIME-CHUNKED decoder (this.chunk frames per chunk).  The same convolutions on the same inputs (bit-identical for
  // the same tiles) with about half the memory per latent px, so a budget holds ~1.7x bigger tiles (less overlap work):
  //  - ResBlocks: conv1 writes a ring of 3 chunks of h; conv2 reads the ring and writes x IN PLACE one chunk behind (conv1 of chunk k+1
  //    has read x[k] before conv2 overwrites it); PixelNorm stats of x once per block, of h per chunk;
  //  - upsamplers: the conv runs one input chunk at a time into a small temp and depth-to-space writes y; the time-only 2x upsampler
  //    (up_blocks.2) writes y INTO x's buffer one chunk behind (y frames 2t-1, 2t overwrite only x frames no later chunk reads);
  //  - up_blocks.3 crops each input chunk (+1 frame each side) from the big tile, so its input is never whole.
  /** activation per stage: frames, px per latent px, channels */
  _dims(T) {
    const S = this.cfg.stages, d = [{ t: T, px: 1, C: S[0].ch }];
    for (let i = 1; i < S.length; i++) { const [p1, p2, p3] = S[i].up, q = d[i - 1]; d.push({ t: q.t * p1 - (p1 - 1), px: q.px * p2 * p3, C: S[i].ch }); }
    return d;
  }
  _inPlace(s, q) { const [p1, p2, p3] = s.up; return p1 === 2 && p2 === 1 && p3 === 1 && s.ch * 2 === q.C; }
  _shardBytes(name) { const s = this.store && this.store.shards && this.store.shards.get && this.store.shards.get(name); return (s && s.bytes) || 150e6; }
  /** conv FLOP per latent px of a big tile (conv_in .. up_blocks.2) and per px of an up_blocks.3 region (its input, the up_blocks.2 output) */
  _flops(T) {
    const S = this.cfg.stages, d = this._dims(T), L = S.length - 1, cv = (ci, co, vox) => 2 * 27 * ci * co * vox;
    let big = cv(128, S[0].ch, T) + 2 * S[0].res * cv(S[0].ch, S[0].ch, T);
    for (let s = 1; s < L; s++) { const q = d[s - 1], a = d[s], PP = S[s].up[0] * S[s].up[1] * S[s].up[2]; big += cv(q.C, a.C * PP, q.t * q.px) + 2 * S[s].res * cv(a.C, a.C, a.t * a.px); }
    const q = d[L - 1], a = d[L], pp = a.px / q.px, PP = S[L].up[0] * S[L].up[1] * S[L].up[2];
    return { big, up3: cv(q.C, a.C * PP, q.t) + 2 * S[L].res * cv(a.C, a.C, a.t * pp) + cv(a.C, 48, a.t * pp) };
  }
  /** chunked plan: the exact peak bytes of every stage (its shard + tensors per px), then the tile size with the least conv work */
  _planC(T, h, w) {
    const S = this.cfg.stages, L = S.length - 1, d = this._dims(T), cf = this.chunk, B = this.budget, misc = 25e6, mg = 1.08;
    let maxBig = Infinity;
    for (let s = 0; s < L; s++) {
      const a = d[s], A = a.t * a.px * a.C * 2, res = A + 3 * cf * a.px * a.C * 2 + (a.t + 3 * cf) * a.px * 4;
      let up = T * 128 * 2 + A;
      if (s > 0) {
        const q = d[s - 1], Q = q.t * q.px * q.C * 2, PP = S[s].up[0] * S[s].up[1] * S[s].up[2];
        up = this._inPlace(S[s], q) ? Math.max(Q, A) + 2 * cf * q.px * q.C * 2 : Q + A + cf * q.px * a.C * PP * 2;
      }
      maxBig = Math.min(maxBig, Math.floor((B - misc - this._shardBytes(S[s].shard)) / (Math.max(res, up) * mg)));
    }
    if (!(maxBig >= 16)) return null;
    // up_blocks.3, per px of its input: crop + conv temp + y | y + ring | y + conv_out temp; the big tile's up_blocks.2 output stays alive
    const q = d[L - 1], a = d[L], pp = a.px / q.px, keep = q.t * q.px * q.C * 2 * mg, y3 = a.t * pp * a.C * 2, r3 = (a.t + 3 * cf) * pp * 4;
    const per4 = Math.max((cf + 2) * q.C * 2 + cf * pp * a.C * 2 + y3, y3 + 3 * cf * pp * a.C * 2 + r3, y3 + r3 + Math.max(cf, 8) * pp * 48 * 2) * mg;
    const fix3 = this._shardBytes(S[L].shard) + misc + 2 * this.sliceBytes, F = this._flops(T);
    let best = null;
    for (let cap = maxBig; cap >= Math.max(16, maxBig / 4); cap = Math.floor(cap * 0.92)) {
      const big = planTiles(h, w, cap);
      if (!big) break;
      const maxSub4 = Math.floor((B - keep * big.maxA - fix3) / per4);
      if (maxSub4 < (2 * HALO3 + 4) ** 2) continue;
      let work = big.tot * F.big, ok = true;
      for (const t of big.tiles) {
        const H4 = (t.y1 - t.y0) * 4, W4 = (t.x1 - t.x0) * 4, c0y = (t.cy0 - t.y0) * 4, c0x = (t.cx0 - t.x0) * 4;
        const sub = planSub((t.cy1 - t.cy0) * 4, (t.cx1 - t.cx0) * 4, maxSub4, HALO3);
        if (!sub) { ok = false; break; }
        for (const u of sub.tiles) work += (Math.min(H4, c0y + u.cy1 + HALO3) - Math.max(0, c0y + u.cy0 - HALO3)) * (Math.min(W4, c0x + u.cx1 + HALO3) - Math.max(0, c0x + u.cx0 - HALO3)) * F.up3;
      }
      if (ok && (!best || work < best.work * 0.999)) { best = big; big.maxSub4 = maxSub4; big.work = work; }
    }
    return best;
  }
  /** a 3x3x3 conv over output frames [t0, t0 + nt) of a stage of x.T frames; x.buf holds frames from x.t0 on, or a ring of x.ring frames */
  convT(sh, name, x, Cout, o) {
    const w = sh.t(name + '.weight'), b = { buf: sh.buf, off: sh.t(name + '.bias').off / 4 };
    gemm(this.g, { acc: this.acc || (this.g.tune && this.g.tune.vaeAcc) || 'f32', w, x: { buf: x.buf }, M: o.nt * x.H * x.W, N: Cout, K: 27 * x.C,
      epi: 'bias', ev: b, res: !!o.res, stats: o.pn ? { buf: o.pn } : undefined, y: { buf: o.y, off: o.yOff || 0 },
      conv: { kind: 'conv3', Hi: x.H, Wi: x.W, Ci: x.C, Ho: x.H, Wo: x.W, stride: x.T, padT: o.t0, padL: x.ring ? 0 : (x.t0 || 0), ks: x.ring || 1, pn: !!o.pn } });
  }
  /** n ResBlocks on x {buf, T, H, W, C} in place; h lives in a ring of 3 chunks */
  async resC(sh, pre, x, n, opts) {
    const g = this.g, cf = this.chunk, HW = x.H * x.W, F = HW * x.C * 2, R = 3 * cf, Rf = Math.min(R, x.T), nk = Math.ceil(x.T / cf);
    const Rx = g.buffer(x.T * HW * 4, 'vae.rstd'), hb = g.buffer(Rf * F, 'vae.h'), Rh = g.buffer(Rf * HW * 4, 'vae.rstd');
    const hr = { buf: hb, T: x.T, H: x.H, W: x.W, C: x.C, ring: R };
    try {
      for (let r = 0; r < n; r++) {
        const n1 = `${pre}.resnets.${r}.conv1.conv`, n2 = `${pre}.resnets.${r}.conv2.conv`;
        pixstats(g, { x: { buf: x.buf }, r: { buf: Rx }, V: x.T * HW, C: x.C });
        const c1 = (k) => { const t0 = k * cf, nt = Math.min(cf, x.T - t0), sl = (k % 3) * cf;
          this.convT(sh, n1, x, x.C, { pn: Rx, y: hb, yOff: sl * F, t0, nt });
          pixstats(g, { x: { buf: hb, off: sl * F }, r: { buf: Rh }, ro: sl * HW, V: nt * HW, C: x.C }); };
        c1(0);
        for (let k = 0; k < nk; k++) {
          if (k + 1 < nk) c1(k + 1);
          const t0 = k * cf;
          this.convT(sh, n2, hr, x.C, { pn: Rh, y: x.buf, yOff: t0 * F, t0, nt: Math.min(cf, x.T - t0), res: true });
        }
        await this.tick(opts);
      }
    } finally { this.drop(Rx, hb, Rh); }
  }
  /** upsampler, one input chunk at a time: conv -> temp -> depth-to-space into a new y; frees x */
  upC(sh, name, x, ch, up) {
    const g = this.g, [p1, p2, p3] = up, PP = p1 * p2 * p3, cf = this.chunk, nk = Math.ceil(x.T / cf);
    const To = x.T * p1 - (p1 - 1), Ho = x.H * p2, Wo = x.W * p3, Fy = Ho * Wo * ch * 2;
    const y = g.buffer(To * Fy, 'vae.x'), c = g.buffer(Math.min(cf, x.T) * x.H * x.W * ch * PP * 2, 'vae.upconv');
    try {
      for (let k = 0; k < nk; k++) {
        const t0 = k * cf, nt = Math.min(cf, x.T - t0), sk = k === 0 ? p1 - 1 : 0;
        this.convT(sh, name, x, ch * PP, { y: c, t0, nt });
        d2s(g, { x: { buf: c }, y: { buf: y, off: (t0 * p1 + sk - (p1 - 1)) * Fy }, T: nt, H: x.H, W: x.W, C: ch, p1, p2, p3, sk, To: nt * p1 - sk });
      }
    } catch (e) { this.drop(y); throw e; } finally { this.drop(c); }
    this.drop(x.buf);
    return { buf: y, T: To, H: Ho, W: Wo, C: ch };
  }
  /** the time-only 2x upsampler (C -> C/2 channels): y goes INTO x's buffer one chunk behind; returns y in x.buf */
  upInPlace(sh, name, x, ch) {
    const g = this.g, cf = this.chunk, nk = Math.ceil(x.T / cf), Fy = x.H * x.W * ch * 2, cb = Math.min(cf, x.T) * x.H * x.W * x.C * 2;
    const cs = [g.buffer(cb, 'vae.upconv'), g.buffer(cb, 'vae.upconv')];
    const emit = (k) => { const t0 = k * cf, nt = Math.min(cf, x.T - t0), sk = k === 0 ? 1 : 0;
      d2s(g, { x: { buf: cs[k % 2] }, y: { buf: x.buf, off: (2 * t0 + sk - 1) * Fy }, T: nt, H: x.H, W: x.W, C: ch, p1: 2, p2: 1, p3: 1, sk, To: 2 * nt - sk }); };
    try {
      for (let k = 0; k < nk; k++) {
        this.convT(sh, name, x, 2 * ch, { y: cs[k % 2], t0: k * cf, nt: Math.min(cf, x.T - k * cf) });   // reads x[t0 - 1 .. t0 + nt]: not overwritten yet
        if (k > 0) emit(k - 1);   // writes x up to the middle of frame t0 - 1, which no later chunk reads
      }
      emit(nk - 1);
    } finally { this.drop(...cs); }
    return { buf: x.buf, T: 2 * x.T - 1, H: x.H, W: x.W, C: ch };
  }

  /** latent: GPUBuffer f32 tokens [T*h*w][128].  sink(rgba Uint8Array [nf][ch][cw], x0, y0, cw, ch, nf, f0) receives every finished core,
   *  a few frames at a time (sliceBytes, default 4 MB), and is awaited before the next slice is read.
   *  opts {check(), onStage({tile, tiles, sub, subs, aliveMB, peakMB})} */
  async decode(latent, T, h, w, sink, opts = {}) {
    const plan = this.plan(T, h, w);
    if (!plan) throw Object.assign(new Error('video too large for the GPU budget'), { code: 'OUT_OF_MEMORY' });
    for (let i = 0; i < plan.tiles.length; i++) await (this.chunk ? this._tileC : this._tile).call(this, latent, T, h, w, plan.tiles[i], plan, sink, opts, i);
    return { F: this.frames(T), H: 32 * h, W: 32 * w, tiles: plan.tiles.length, grid: [plan.ny, plan.nx], maxTileArea: plan.maxA, maxSub4: plan.maxSub4 };
  }

  async _tile(latent, T, h, w, t, plan, sink, opts, ti) {
    const g = this.g, st = this.store, th = t.y1 - t.y0, tw = t.x1 - t.x0, S = this.cfg.stages;
    const report = (sub, subs) => { if (opts.onStage) opts.onStage({ tile: ti, tiles: plan.tiles.length, sub, subs, aliveMB: Math.round(g.alive / 1e6), peakMB: Math.round(g.peak / 1e6), jsMB: +(this.jsBytes / 1e6).toFixed(1), pool: g.poolStats() }); };
    let x = null, sh = null, R = null;
    try {
      // ---- big tile: conv_in, mid block, up_blocks.0 .. 2
      for (let si = 0; si < S.length - 1; si++) {
        const s = S[si];
        sh = await st.upload(s.shard);
        if (si === 0) {
          const z = g.buffer(T * th * tw * 128 * 2, 'vae.z');
          vop(g, { op: 'ltxin', n: T * th * tw * 64, af: { buf: latent }, bf: { buf: sh.buf }, yu: { buf: z }, a: w, b: h, c: t.x0 | (t.y0 << 16),
            d: sh.t('latents_mean').off / 4, e: sh.t('latents_std').off / 4, f: tw | (th << 16) });
          const y = g.buffer(T * th * tw * s.ch * 2, 'vae.x');
          this.conv(sh, 'decoder.conv_in.conv', { buf: z, T, H: th, W: tw, C: 128 }, s.ch, { y });
          this.drop(z); x = { buf: y, T, H: th, W: tw, C: s.ch };
          R = g.buffer(T * th * tw * 4, 'vae.rstd');
          await this.res(sh, 'decoder.mid_block', x, s.res, R, opts);
        } else {
          this.drop(R); R = null;
          x = this.upsample(sh, `decoder.up_blocks.${si - 1}.upsamplers.0.conv.conv`, x, s.ch, s.up);
          R = g.buffer(x.T * x.H * x.W * 4, 'vae.rstd');
          await this.tick(opts);
          await this.res(sh, `decoder.up_blocks.${si - 1}`, x, s.res, R, opts);
        }
        g.runner.flush(); st.release(sh); sh = null;
        await g.done(); if (opts.check) opts.check(); report(0, 0);
      }
      this.drop(R); R = null;
      // ---- up_blocks.3 + conv_out on exact sub-tiles of the big tile's core (x: [F][4th][4tw][256])
      const s = S[S.length - 1], up = `decoder.up_blocks.${S.length - 2}`;
      sh = await st.upload(s.shard);
      const c0y = (t.cy0 - t.y0) * 4, c1y = (t.cy1 - t.y0) * 4, c0x = (t.cx0 - t.x0) * 4, c1x = (t.cx1 - t.x0) * 4;
      const sub = planSub(c1y - c0y, c1x - c0x, plan.maxSub4, HALO3);
      if (!sub) throw Object.assign(new Error('decoder sub-tile does not fit the budget'), { code: 'OUT_OF_MEMORY' });
      for (let k = 0; k < sub.tiles.length; k++) {
        const q = sub.tiles[k], sy0 = c0y + q.cy0, sy1 = c0y + q.cy1, sx0 = c0x + q.cx0, sx1 = c0x + q.cx1;   // sub core (4x px, tile coords)
        const ry0 = Math.max(0, sy0 - HALO3), ry1 = Math.min(x.H, sy1 + HALO3), rx0 = Math.max(0, sx0 - HALO3), rx1 = Math.min(x.W, sx1 + HALO3);
        const rh = ry1 - ry0, rw = rx1 - rx0, xs = g.buffer(x.T * rh * rw * x.C * 2, 'vae.sub');
        vop(g, { op: 'crop', n: x.T * rh * rw * x.C / 2, ah: { buf: x.buf }, yu: { buf: xs }, a: x.C / 2, b: x.W, c: x.H, d: rx0 | (ry0 << 16), e: rw | (rh << 16) });
        let y = this.upsample(sh, `${up}.upsamplers.0.conv.conv`, { buf: xs, T: x.T, H: rh, W: rw, C: x.C }, s.ch, s.up);
        const R3 = g.buffer(y.T * y.H * y.W * 4, 'vae.rstd');
        await this.tick(opts);
        await this.res(sh, up, y, s.res, R3, opts);
        const V = y.T * y.H * y.W, o = g.buffer(V * 48 * 2, 'vae.out16');
        pixstats(g, { x: { buf: y.buf }, r: { buf: R3 }, V, C: y.C });
        this.conv(sh, 'decoder.conv_out.conv', y, 48, { pn: R3, y: o });           // f16 (values in [-1, 1]: < 0.07 LSB)
        this.drop(y.buf, R3);
        const bx = (sx0 - rx0) * 8, cx = (sx1 - rx0) * 8, by = (sy0 - ry0) * 8, cy = (sy1 - ry0) * 8, cw = cx - bx, chh = cy - by;   // pixels (8 per 4x px)
        // RGBA8 on the GPU and back to the page in small frame slices through ONE reused staging buffer; each slice is written to
        // OPFS (awaited) before the next is read, so the page never holds more than ~2 slices (the v003 phone kill was a 22 MB+ part readback)
        const fb = cw * chh * 4, nfs = Math.max(1, Math.min(y.T, Math.floor(this.sliceBytes / fb))), sb = nfs * fb;
        // p0pc0rn v026.2: ONE staging buffer per decoder, kept across sub-tiles, tiles and clips (it was made and destroyed per sub-tile)
        if (!this._stg || this._stg.size < sb || this._stgDev !== g.device) { if (this._stg && this._stgDev === g.device) this._stg.destroy(); this._stg = g.device.createBuffer({ size: sb, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'vae.staging' }); this._stgDev = g.device; }
        const px = g.buffer(sb, 'vae.rgba.slice'), stg = this._stg;
        try {
          for (let f0 = 0; f0 < y.T; f0 += nfs) {
            const nf = Math.min(nfs, y.T - f0), bytes = nf * fb;
            vop(g, { op: 'ltxrgba16', n: nf * cw * chh, ah: { buf: o }, yu: { buf: px }, a: f0, b: bx, c: cx, d: by, e: cy, f: (y.W << 16) | y.H });
            g.runner.flush();
            const enc = g.device.createCommandEncoder(); enc.copyBufferToBuffer(px, 0, stg, 0, bytes); g.device.queue.submit([enc.finish()]);
            await stg.mapAsync(GPUMapMode.READ, 0, bytes);
            const data = stg.getMappedRange(0, bytes).slice(0); stg.unmap();
            this.jsBytes = bytes * 2 + sb;   // staging + the copy in flight (+ the worker's view)
            await sink(new Uint8Array(data), t.x0 * 32 + sx0 * 8, t.y0 * 32 + sy0 * 8, cw, chh, nf, f0);
            if (opts.check) opts.check();
          }
        } finally { this.drop(o, px); }
        if (opts.check) opts.check();
        report(k + 1, sub.tiles.length);
      }
      st.release(sh); sh = null;
    } finally { if (sh) st.release(sh); this.drop(x && x.buf, R); await g.done(); }
  }

  /** v029: one big tile with the time-chunked stages (see _planC) */
  async _tileC(latent, T, h, w, t, plan, sink, opts, ti) {
    const g = this.g, st = this.store, th = t.y1 - t.y0, tw = t.x1 - t.x0, S = this.cfg.stages, L = S.length - 1, cf = this.chunk;
    const report = (sub, subs) => { if (opts.onStage) opts.onStage({ tile: ti, tiles: plan.tiles.length, sub, subs, aliveMB: Math.round(g.alive / 1e6), peakMB: Math.round(g.peak / 1e6), jsMB: +(this.jsBytes / 1e6).toFixed(1), pool: g.poolStats() }); };
    let x = null, sh = null;
    try {
      // ---- big tile: conv_in, mid block, up_blocks.0 .. 2
      for (let si = 0; si < L; si++) {
        const s = S[si];
        sh = await st.upload(s.shard);
        if (si === 0) {
          const z = g.buffer(T * th * tw * 128 * 2, 'vae.z');
          vop(g, { op: 'ltxin', n: T * th * tw * 64, af: { buf: latent }, bf: { buf: sh.buf }, yu: { buf: z }, a: w, b: h, c: t.x0 | (t.y0 << 16),
            d: sh.t('latents_mean').off / 4, e: sh.t('latents_std').off / 4, f: tw | (th << 16) });
          const y = g.buffer(T * th * tw * s.ch * 2, 'vae.x');
          this.conv(sh, 'decoder.conv_in.conv', { buf: z, T, H: th, W: tw, C: 128 }, s.ch, { y });
          this.drop(z); x = { buf: y, T, H: th, W: tw, C: s.ch };
          await this.resC(sh, 'decoder.mid_block', x, s.res, opts);
        } else {
          const name = `decoder.up_blocks.${si - 1}.upsamplers.0.conv.conv`;
          x = this._inPlace(s, x) ? this.upInPlace(sh, name, x, s.ch) : this.upC(sh, name, x, s.ch, s.up);
          await this.tick(opts);
          await this.resC(sh, `decoder.up_blocks.${si - 1}`, x, s.res, opts);
        }
        g.runner.flush(); st.release(sh); sh = null;
        await g.done(); if (opts.check) opts.check(); report(0, 0);
      }
      // ---- up_blocks.3 + conv_out on exact sub-tiles of the big tile's core (x: [F][4th][4tw][256]); the input is cropped one chunk at a time
      const s = S[L], up = `decoder.up_blocks.${L - 1}`, [p1, p2, p3] = s.up, PP = p1 * p2 * p3, Fx = x.H * x.W * x.C * 2;
      sh = await st.upload(s.shard);
      const c0y = (t.cy0 - t.y0) * 4, c1y = (t.cy1 - t.y0) * 4, c0x = (t.cx0 - t.x0) * 4, c1x = (t.cx1 - t.x0) * 4;
      const sub = planSub(c1y - c0y, c1x - c0x, plan.maxSub4, HALO3);
      if (!sub) throw Object.assign(new Error('decoder sub-tile does not fit the budget'), { code: 'OUT_OF_MEMORY' });
      for (let k = 0; k < sub.tiles.length; k++) {
        const q = sub.tiles[k], sy0 = c0y + q.cy0, sy1 = c0y + q.cy1, sx0 = c0x + q.cx0, sx1 = c0x + q.cx1;   // sub core (4x px, tile coords)
        const ry0 = Math.max(0, sy0 - HALO3), ry1 = Math.min(x.H, sy1 + HALO3), rx0 = Math.max(0, sx0 - HALO3), rx1 = Math.min(x.W, sx1 + HALO3);
        const rh = ry1 - ry0, rw = rx1 - rx0, nk = Math.ceil(x.T / cf), Ho = rh * p2, Wo = rw * p3, Fy = Ho * Wo * s.ch * 2, To = x.T * p1 - (p1 - 1);
        const yb = g.buffer(To * Fy, 'vae.x'), G = g.buffer(Math.min(cf + 2, x.T) * rh * rw * x.C * 2, 'vae.sub'), c = g.buffer(Math.min(cf, x.T) * rh * rw * s.ch * PP * 2, 'vae.upconv');
        try {
          for (let j = 0; j < nk; j++) {
            const t0 = j * cf, nt = Math.min(cf, x.T - t0), g0 = Math.max(0, t0 - 1), g1 = Math.min(x.T, t0 + nt + 1), sk = j === 0 ? p1 - 1 : 0;
            vop(g, { op: 'crop', n: (g1 - g0) * rh * rw * x.C / 2, ah: { buf: x.buf, off: g0 * Fx }, yu: { buf: G }, a: x.C / 2, b: x.W, c: x.H, d: rx0 | (ry0 << 16), e: rw | (rh << 16) });
            this.convT(sh, `${up}.upsamplers.0.conv.conv`, { buf: G, T: x.T, H: rh, W: rw, C: x.C, t0: g0 }, s.ch * PP, { y: c, t0, nt });
            d2s(g, { x: { buf: c }, y: { buf: yb, off: (t0 * p1 + sk - (p1 - 1)) * Fy }, T: nt, H: rh, W: rw, C: s.ch, p1, p2, p3, sk, To: nt * p1 - sk });
          }
        } catch (e) { this.drop(yb); throw e; } finally { this.drop(G, c); }
        const y = { buf: yb, T: To, H: Ho, W: Wo, C: s.ch };
        try { await this.tick(opts); await this.resC(sh, up, y, s.res, opts); } catch (e) { this.drop(yb); throw e; }
        const HW = y.H * y.W, og = Math.min(y.T, Math.max(cf, 8)), R3 = g.buffer(y.T * HW * 4, 'vae.rstd'), o = g.buffer(og * HW * 48 * 2, 'vae.out16');
        pixstats(g, { x: { buf: y.buf }, r: { buf: R3 }, V: y.T * HW, C: y.C });
        const bx = (sx0 - rx0) * 8, cx = (sx1 - rx0) * 8, by = (sy0 - ry0) * 8, cy = (sy1 - ry0) * 8, cw = cx - bx, chh = cy - by;   // pixels (8 per 4x px)
        const fb = cw * chh * 4, nfs = Math.max(1, Math.min(og, Math.floor(this.sliceBytes / fb))), sb = nfs * fb;
        if (!this._stg || this._stg.size < sb || this._stgDev !== g.device) { if (this._stg && this._stgDev === g.device) this._stg.destroy(); this._stg = g.device.createBuffer({ size: sb, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'vae.staging' }); this._stgDev = g.device; }
        const px = g.buffer(sb, 'vae.rgba.slice'), stg = this._stg;
        try {
          for (let t0 = 0; t0 < y.T; t0 += og) {   // conv_out <= 8 frames at a time, read back in slices of <= sliceBytes
            const nt = Math.min(og, y.T - t0);
            this.convT(sh, 'decoder.conv_out.conv', y, 48, { pn: R3, y: o, t0, nt });           // f16 (values in [-1, 1]: < 0.07 LSB)
            for (let f0 = 0; f0 < nt; f0 += nfs) {
              const nf = Math.min(nfs, nt - f0), bytes = nf * fb;
              vop(g, { op: 'ltxrgba16', n: nf * cw * chh, ah: { buf: o }, yu: { buf: px }, a: f0, b: bx, c: cx, d: by, e: cy, f: (y.W << 16) | y.H });
              g.runner.flush();
              const enc = g.device.createCommandEncoder(); enc.copyBufferToBuffer(px, 0, stg, 0, bytes); g.device.queue.submit([enc.finish()]);
              await stg.mapAsync(GPUMapMode.READ, 0, bytes);
              const data = stg.getMappedRange(0, bytes).slice(0); stg.unmap();
              this.jsBytes = bytes * 2 + sb;
              await sink(new Uint8Array(data), t.x0 * 32 + sx0 * 8, t.y0 * 32 + sy0 * 8, cw, chh, nf, t0 + f0);
              if (opts.check) opts.check();
            }
          }
        } finally { this.drop(o, px, R3, y.buf); }
        if (opts.check) opts.check();
        report(k + 1, sub.tiles.length);
      }
      st.release(sh); sh = null;
    } finally { if (sh) st.release(sh); this.drop(x && x.buf); await g.done(); }
  }
}

return { ltxFlopsPerPixelFrame, planTiles, planSub, LTX2Decoder };
})();
// ---- pipelines/klein.js
__M["pipelines/klein.js"] = (() => {
// FLUX.2 [klein] t2i / i2i pipeline: phases, memory plan (one phase's buffers at a time), prompt cache (memory 2 + OPFS 16),
// latent checkpoints after every step (resume after an iOS kill), progress with a FLOP-model ETA corrected by measured time.
// Phases: text -> (encode) -> denoise (globals + steps) -> decode.  Every GPU buffer of a phase is freed before the next phase.
'use strict';
const { KleinTE, teFlops } = __M["models/klein_te.js"];
const { KleinDiT, flux2Sigmas, ditStepFlops } = __M["models/klein_dit.js"];
const { Flux2VAE, vaeDecodeFlops, vaeEncodeFlops } = __M["models/flux2_vae.js"];
const { toF16 } = __M["core/gpu.js"];
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const hex = (ab) => Array.from(new Uint8Array(ab), (b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s));

/** seeded standard normal noise in the reference layout [128][h][w], returned as DiT tokens [h*w][128] */
function gaussianTokens(seed, h, w) {
  let a = (seed >>> 0) ^ 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = (seed * 2654435761) >>> 0;
  const next = () => { const t = (b << 9) >>> 0; let r = Math.imul(a, 5); r = Math.imul((r << 7) | (r >>> 25), 9) >>> 0; c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = ((d << 11) | (d >>> 21)) >>> 0; return r / 4294967296; };
  for (let i = 0; i < 16; i++) next();
  const n = 128 * h * w, z = new Float32Array(n);
  for (let i = 0; i < n; i += 2) { const u = Math.max(next(), 1e-12), v = next(), r = Math.sqrt(-2 * Math.log(u)); z[i] = r * Math.cos(2 * Math.PI * v); if (i + 1 < n) z[i + 1] = r * Math.sin(2 * Math.PI * v); }
  return chwToTokens(z, h, w);
}
function chwToTokens(z, h, w) { const t = new Float32Array(128 * h * w); for (let c = 0; c < 128; c++) for (let p = 0; p < h * w; p++) t[p * 128 + c] = z[c * h * w + p]; return t; }

class KleinPipeline {
  /** ctx: {gpu, store, emit(p), warn(code, message)} */
  constructor(ctx) { this.ctx = ctx; this.condMem = []; this.bind(ctx.gpu); }
  bind(gpu) {
    this.g = gpu; this.ctx.store.gpu = gpu;
    this.te = new KleinTE(gpu, this.ctx.store); this.dit = new KleinDiT(gpu, this.ctx.store); this.vae = new Flux2VAE(gpu, this.ctx.vaeOpts || {});
  }
  get st() { return this.ctx.store.http ? null : this.ctx.store.st; }
  async _opfsWrite(name, data) { if (!this.st) return; const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); await this.st.call('write', { name, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('flush', { name }); await this.st.call('close', { name }); }
  async _opfsRead(name) { if (!this.st) return null; const sz = (await this.st.call('size', { name })).size; if (sz <= 0) return null; const r = await this.st.call('read', { name, at: 0, len: sz }); await this.st.call('close', { name }); return r.buf.slice(0, sz); }

  // ------------------------------------------------------------------ prompt conditioning cache (f16 [512][7680] = 7.9 MB per prompt)
  async getCond(prompt, onLayer, check) {
    const pv = this.ctx.store.m.pack_version, key = await sha(pv + '\n' + prompt);
    let hit = this.condMem.find((e) => e.key === key), cached = !!hit;
    if (!hit && this.st) {
      const idx = JSON.parse(LS('pocketflux:cond') || '[]');
      if (idx.includes(key)) { const ab = await this._opfsRead(`pocketflux/cond/${key}.bin`); if (ab && ab.byteLength > 8) { const T = new Uint32Array(ab, 0, 2)[0]; hit = { key, T, nvalid: new Uint32Array(ab, 0, 2)[1], data: new Uint16Array(ab, 8) }; cached = true; } }
    }
    if (!hit) {
      const r = await this.te.encode(prompt, { onLayer, check });
      const data = new Uint16Array(await this.g.read(r.cond, 0, r.T * 7680 * 2));
      hit = { key, T: r.T, nvalid: r.nvalid, data, gpu: r.cond };
      if (this.st) {
        const ab = new Uint8Array(8 + data.byteLength); new Uint32Array(ab.buffer, 0, 2).set([r.T, r.nvalid]); ab.set(new Uint8Array(data.buffer), 8);
        try {
          await this._opfsWrite(`pocketflux/cond/${key}.bin`, ab);
          let idx = JSON.parse(LS('pocketflux:cond') || '[]').filter((k) => k !== key); idx.push(key);
          while (idx.length > 16) { const old = idx.shift(); try { await this.st.call('remove', { name: `pocketflux/cond/${old}.bin` }); } catch (e) { /* */ } }
          LS('pocketflux:cond', JSON.stringify(idx));
        } catch (e) { /* cache is optional */ }
      }
    }
    this.condMem = [hit].concat(this.condMem.filter((e) => e.key !== key)).slice(0, 2).map((e) => ({ key: e.key, T: e.T, nvalid: e.nvalid, data: e.data }));
    const cond = hit.gpu || this.g.upload(hit.data, 'cond');
    return { cond, T: hit.T, nvalid: hit.nvalid, cached };
  }

  // ------------------------------------------------------------------ the job
  /** job: {kind: 't2i'|'i2i', prompt, width, height, seed, steps, image: {data (RGBA u8), width, height} (i2i, already cropped+scaled to the
   *  reference size), check(), onProgress(p), noiseTokens?, condOverride?, refTokens?, keepLatent?} */
  async run(job) {
    const g = this.g, W = job.width, H = job.height, h = H / 16, w = W / 16, steps = job.steps, nImg = h * w;
    const rate = g.rate, t0 = performance.now(), timings = { text: 0, encode: 0, denoise: 0, decode: 0, steps: [] }, up0 = this.ctx.store.stats.uploadMs;
    const ref = job.kind === 'i2i' ? { h: job.image.height / 16, w: job.image.width / 16 } : null, nRef = ref ? ref.h * ref.w : 0, L = 512 + nImg + nRef;
    const keyStr = JSON.stringify([job.kind, job.prompt, W, H, job.seed, steps, ref && [ref.h, ref.w], job.imageHash || '', this.ctx.store.m.pack_version]);
    const key = await sha(keyStr);
    // FLOP-model phase estimates (seconds), corrected by the measured / estimated ratio as phases finish
    const r32 = rate.mm32 || rate.mm, rd = (g.tune && g.tune.acc === 'f16' ? rate.mm16 : rate.mm32) || rate.mm;
    const est = { text: teFlops(512) / r32 + 1.0, encode: ref ? vaeEncodeFlops(job.image.height, job.image.width) / (r32 * 0.85) : 0,
      glob: 0.25e12 / r32 + 0.2, step: (2 * L * 3.0682e9) / rd + (25 * 4 * L * L * 128 * 24) / rate.attn + 2.5e9 / 2e9,
      decode: vaeDecodeFlops(H, W) / (r32 * 0.85) + 0.5 };
    let total = est.text + est.encode + est.glob + steps * est.step + est.decode, done = 0, corr = 1, phase = 'load', lastEmit = 0, step = 0;
    const emit = (frac, msg, force) => {
      const now = performance.now(); if (!force && now - lastEmit < 200) return; lastEmit = now;
      const f = msg === 'done' ? 1 : Math.min(0.999, (done + frac) / total), el = (now - t0) / 1000;
      const eta = Math.max(0, Math.round((total - done - frac) * corr));
      const p = { phase, frac: f, step, steps, etaSeconds: eta, message: msg || phase, elapsed: el, pool: this.g && this.g.poolStats ? this.g.poolStats() : null };   // v026.3
      if (job.onProgress) job.onProgress(p); if (this.ctx.emit) this.ctx.emit(p);
    };
    const finish = (estS, realS) => { done += estS; corr = 0.5 * corr + 0.5 * (realS / Math.max(estS, 1e-3)); };
    const mark = (ph, extra) => LS('pocketflux:running', JSON.stringify(Object.assign({ phase: ph, kind: job.kind, w: W, h: H, steps, t: Date.now() }, extra || {})));
    // resume from a checkpoint of the same job?
    let ck = null; try { ck = JSON.parse(LS('pocketflux:ckpt') || 'null'); } catch (e) { ck = null; }
    let startStep = 0, latentInit = null, refTokens = job.refTokens || null;
    if (ck && ck.key === key && !job.noResume && this.st) {
      const lab = await this._opfsRead('pocketflux/ckpt/latent.bin'), rab = ref ? await this._opfsRead('pocketflux/ckpt/ref.bin') : null;
      if (lab && lab.byteLength === nImg * 512 && (!ref || (rab && rab.byteLength === nRef * 512))) { startStep = ck.step; latentInit = new Float32Array(lab); if (ref) refTokens = new Float32Array(rab); }
    }
    const result = { resumedFromStep: startStep };
    // ---- text
    phase = 'text'; mark('text'); emit(0, 'Reading the prompt', true);
    let ts = performance.now();
    const cond = job.condOverride ? { cond: g.upload(job.condOverride, 'cond'), T: 512 } :
      await this.getCond(job.prompt, (l) => emit(est.text * (l + 1) / 27, 'Reading the prompt'), job.check);
    timings.text = (performance.now() - ts) / 1000; result.textCached = !!cond.cached;
    if (cond.cached) { total -= est.text; } else finish(est.text, timings.text);
    try {
      // ---- encode (i2i)
      if (ref && !refTokens) {
        phase = 'encode'; mark('encode'); emit(0, 'Reading your picture', true); ts = performance.now();
        const img = job.image, f16 = new Float32Array(img.width * img.height * 3);
        for (let i = 0, j = 0; i < img.width * img.height; i++) { f16[j++] = img.data[4 * i] / 255 * 2 - 1; f16[j++] = img.data[4 * i + 1] / 255 * 2 - 1; f16[j++] = img.data[4 * i + 2] / 255 * 2 - 1; }
        const ib = g.upload(toF16(f16), 'vae.img');
        const se = await this.ctx.store.upload('vae.enc'), bn = await this.ctx.store.uploadPart('vae.dec', ['bn.running_mean', 'bn.running_var']);
        try { refTokens = await this.vae.encode(se, bn, ib, img.height, img.width, { check: job.check }); }
        finally { this.ctx.store.release(se); g.runner.flush(); g.free(bn.buf); g.free(ib); }
        timings.encode = (performance.now() - ts) / 1000; finish(est.encode, timings.encode);
        if (this.st) await this._opfsWrite('pocketflux/ckpt/ref.bin', refTokens);
      } else if (ref) total -= est.encode;
      result.refTokens = job.keepLatent ? refTokens : undefined;
      // ---- denoise
      phase = 'denoise'; mark('denoise', { step: startStep }); emit(0, 'Preparing', true); ts = performance.now();
      const sig = flux2Sigmas(W, H, steps);
      const S = await this.dit.prepare(cond, sig, h, w, ref ? [{ h: ref.h, w: ref.w, tokens: refTokens }] : []);
      g.runner.flush(); g.free(cond.cond);
      finish(est.glob, (performance.now() - ts) / 1000);
      const lat = g.upload(latentInit || job.noiseTokens || gaussianTokens(job.seed, h, w), 'latent');
      try {
        let best = Infinity; if (startStep) { total -= startStep * est.step; }
        for (let k = startStep; k < steps; k++) {
          step = k + 1; const tk = performance.now();
          emit(0, `Step ${k + 1} of ${steps}`, true);
          await this.dit.step(S, k, lat, { check: job.check, onBlock: (i) => emit(est.step * (i + 1) / 26, `Step ${k + 1} of ${steps}`) });
          const sec = (performance.now() - tk) / 1000; timings.steps.push(+sec.toFixed(2)); finish(est.step, sec);
          if (sec > 1.25 * best && this.ctx.warn && !result.hot) { result.hot = true; this.ctx.warn('HOT', `Step time grew from ${best.toFixed(1)} s to ${sec.toFixed(1)} s: the phone is probably throttling.`); }
          best = Math.min(best, sec);
          if (job.stepLatents) job.stepLatents.push(new Float32Array(await g.read(lat)));
          if (this.st && k + 1 < steps) {
            await this._opfsWrite('pocketflux/ckpt/latent.bin', new Float32Array(await g.read(lat)));
            LS('pocketflux:ckpt', JSON.stringify({ key, step: k + 1 })); mark('denoise', { step: k + 1 });
          }
        }
        this.dit.free(S);
        timings.denoise = (performance.now() - ts) / 1000;
        if (job.keepLatent) result.latent = new Float32Array(await g.read(lat));
        // ---- decode
        phase = 'decode'; mark('decode'); emit(0, 'Making the pixels', true); ts = performance.now();
        const sd = await this.ctx.store.upload('vae.dec');
        try { Object.assign(result, await this.vae.decode(sd, lat, h, w, { check: job.check, rgbFloat: job.rgbFloat, forceBand: job.forceBand, onBlock: (i) => emit(est.decode * (i + 1) / 16, 'Making the pixels') })); }
        finally { this.ctx.store.release(sd); }
        timings.decode = (performance.now() - ts) / 1000; finish(est.decode, timings.decode);
      } finally { g.runner.flush(); g.free(lat); this.dit.free(S); }
    } finally { g.runner.flush(); if (cond.cond) g.free(cond.cond); }
    LS('pocketflux:ckpt', null);
    timings.upload = +((this.ctx.store.stats.uploadMs - up0) / 1000).toFixed(2);
    result.timings = timings; result.seconds = (performance.now() - t0) / 1000; result.peakMB = Math.round(g.peak / 1e6);
    phase = 'decode'; step = steps; emit(total - done, 'done', true);
    return result;
  }
}

return { sha, gaussianTokens, chwToTokens, KleinPipeline };
})();
// ---- pipelines/sana_video.js
__M["pipelines/sana_video.js"] = (() => {
// Text-to-video pipeline (SANA-Video 2.0 5B 4-step + Gemma-2 + LTX-2.3 decoder): text -> denoise -> decode -> encode.
// Phone safety:
//  - the latent is checkpointed to OPFS after EVERY step (+ prompt / size / seed in localStorage), so a kill resumes from the last
//    finished step, and a kill during decode / encode resumes with decode only (the 4 steps are never paid twice);
//  - before decode every DiT / text-encoder buffer is destroyed and the queue drained (destruction is real), and the decoder runs under an
//    explicit GPU budget (Apple GPUs 450 MB by default: 560 survived cool, died hot on the iPhone 16 Pro Max);
//  - decoded tiles go straight to an OPFS frames file (never all frames in JS or on the GPU); the encoder reads one frame at a time.
'use strict';
const { GemmaTE } = __M["models/gemma_te.js"];
const { SanaDiT, sanaStepFlops } = __M["models/sana_dit.js"];
const { LTX2Decoder, ltxFlopsPerPixelFrame } = __M["models/ltx2_vae.js"];
const { gaussianTokens, sha } = __M["pipelines/klein.js"];
const { muxMp4 } = __M["vendor/mp4mux.js"];
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const VIDEO_CKPT = 'pocketvideo:ckpt';
const DIR = 'engine/sanavideo2-5b/run';

/** readFrame(f) -> Uint8Array RGBA (W*H*4) for f = 0..F-1  ->  MP4 bytes (H.264 via WebCodecs) */
async function encodeMp4(readFrame, F, H, W, fps, onFrame) {
  if (typeof VideoEncoder === 'undefined') throw Object.assign(new Error('this browser has no WebCodecs VideoEncoder'), { code: 'UNSUPPORTED' });
  const base = { width: W, height: H, bitrate: Math.round(W * H * fps * 0.6), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  let config = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    try { const s = await VideoEncoder.isConfigSupported(Object.assign({ codec }, base)); if (s.supported) { config = s.config; break; } } catch (e) { /* next */ }
  }
  if (!config) {   // p0pc0rn v026.9: no H.264 encoder (some Android builds): VP9 in the same MP4
    const vb = Object.assign({}, base); delete vb.avc;
    for (const codec of ['vp09.00.31.08', 'vp09.00.40.08']) {
      try { const s = await VideoEncoder.isConfigSupported(Object.assign({ codec }, vb)); if (s.supported) { config = s.config; break; } } catch (e) { /* next */ }
    }
  }
  if (!config) throw Object.assign(new Error('neither H.264 nor VP9 encoding is supported here'), { code: 'UNSUPPORTED' });
  const samples = []; let avcC = null, err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => {
    if (meta && meta.decoderConfig && meta.decoderConfig.description) avcC = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description);
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); samples.push({ data: d, key: chunk.type === 'key' }); }, error: (e) => { err = e; } });
  enc.configure(config);
  for (let f = 0; f < F; f++) {
    const vf = new VideoFrame(await readFrame(f), { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: f % (2 * fps) === 0 }); vf.close();
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    if (err) throw err;
    if (onFrame) onFrame(f);
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  const vp9 = /^vp09/.test(config.codec);
  if (!avcC && !vp9) throw new Error('encoder gave no avcC configuration');
  return { mp4: muxMp4({ width: W, height: H, fps, avcC, samples, codec: config.codec }), codec: config.codec };
}

class SanaVideoPipeline {
  constructor(ctx) { this.ctx = ctx; this.condMem = []; this.bind(ctx.gpu); }
  bind(gpu) {
    this.g = gpu; this.ctx.store.gpu = gpu;
    const apple = /apple/i.test((gpu.info && gpu.info.vendor) || '');
    this.te = new GemmaTE(gpu, this.ctx.store); this.dit = new SanaDiT(gpu, this.ctx.store);
    this.vae = new LTX2Decoder(gpu, this.ctx.store, Object.assign({ budgetBytes: apple ? 450e6 : 1.2e9 }, this.ctx.vaeOpts || {}));
  }
  get st() { return this.ctx.store.st; }
  async getCond(prompt, onLayer, check) {
    const key = await sha(this.ctx.store.m.pack_version + '\n' + prompt);
    let hit = this.condMem.find((e) => e.key === key), cached = !!hit;
    if (!hit) {
      const r = await this.te.encode(prompt, { onLayer, check });
      hit = { key, nvalid: r.nvalid, data: new Uint16Array(await this.g.read(r.cond)), gpu: r.cond };
    }
    this.condMem = [hit].concat(this.condMem.filter((e) => e.key !== key)).slice(0, 2).map((e) => ({ key: e.key, nvalid: e.nvalid, data: e.data }));
    return { cond: hit.gpu || this.g.upload(hit.data, 'cond'), nvalid: hit.nvalid, cached };
  }
  async _write(name, u8) { const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); await this.st.call('write', { name, at: 0, buf: ab, truncate: 0 }, [ab]); await this.st.call('flush', { name }); }
  async _read(name, len) { const sz = (await this.st.call('size', { name })).size; if (sz !== len) return null; return new Float32Array((await this.st.call('read', { name, at: 0, len })).buf, 0, len / 4); }
  static checkpoint() { try { return JSON.parse(LS(VIDEO_CKPT) || 'null'); } catch (e) { return null; } }

  /** job {prompt, width, height, frames, seed, fps, check, onProgress, noise0?, noiseT?, condOverride?, keepVelocity?, stepLatents?, keepLatent?,
   *  noEncode?, keepFrames?, noResume?} */
  async run(job) {
    const g = this.g, c = this.ctx.store.m.model, W = job.width, H = job.height, F = job.frames, T = (F - 1) / c.vae.t_compress + 1, h = H / 32, w = W / 32, N = T * h * w;
    const fps = job.fps || c.video.fps, steps = c.dit.sigmas.length, t0 = performance.now(), up0 = this.ctx.store.stats.uploadMs;
    await this.st.start();
    const timings = { text: 0, denoise: 0, steps: [], decode: 0, encode: 0, tileLog: [] }, rate = g.rate, r32 = rate.mm32 || rate.mm, r16 = rate.mm16 || rate.mm;
    const vaeRate = (g.tune && g.tune.vaeAcc === 'f16' ? r16 : r32) * 0.8, plan = this.vae.plan(T, h, w);
    if (!plan) throw Object.assign(new Error('this size does not fit the decoder memory budget'), { code: 'OUT_OF_MEMORY' });
    const key = await sha(JSON.stringify([job.prompt, W, H, F, job.seed, this.ctx.store.m.pack_version]));
    // ---- resume?
    let ck = SanaVideoPipeline.checkpoint(), startStep = 0, latInit = null;
    if (ck && ck.key === key && !job.noResume && !job.noise0) { latInit = await this._read(`${DIR}/latent.bin`, N * 512); if (latInit) startStep = Math.min(steps, ck.step); }
    const tileFactor = plan.tot / (h * w) * 1.25;
    const est = { text: startStep ? 0 : 1.2e12 / r32 + 1, step: sanaStepFlops(N) / r16 + 2.9e9 / 2e9, decode: (ltxFlopsPerPixelFrame * F * H * W * tileFactor) / vaeRate + 2, encode: F * 0.05 };
    let total = est.text + (steps - startStep) * est.step + est.decode + est.encode, done = 0, corr = 1, phase = 'load', step = startStep, last = 0;
    const emit = (frac, msg, force, extra) => {
      const now = performance.now(); if (!force && now - last < 200) return; last = now;
      const p = Object.assign({ phase, frac: msg === 'done' ? 1 : Math.min(0.999, (done + frac) / total), step, steps, etaSeconds: Math.max(0, Math.round((total - done - frac) * corr)), message: msg || phase,
        elapsed: (now - t0) / 1000, pool: this.g && this.g.poolStats ? this.g.poolStats() : null }, extra || {});   // v026.3
      if (job.onProgress) job.onProgress(p); if (this.ctx.emit) this.ctx.emit(p);
    };
    const finish = (e, s) => { done += e; corr = 0.5 * corr + 0.5 * (s / Math.max(e, 1e-3)); };
    const mark = (ph, extra) => LS('pocketvideo:running', JSON.stringify(Object.assign({ phase: ph, w: W, h: H, frames: F, t: Date.now() }, extra || {})));
    const saveCk = async (k, lat) => { await this._write(`${DIR}/latent.bin`, new Uint8Array(await g.read(lat))); LS(VIDEO_CKPT, JSON.stringify({ key, step: k, prompt: job.prompt, width: W, height: H, frames: F, seed: job.seed, t: Date.now() })); };
    const result = { resumedFromStep: startStep, nvalid: null, textCached: false };
    let lat = null;
    try {
      if (startStep < steps) {
        // ---- text
        phase = 'text'; mark('text'); emit(0, 'Reading the prompt', true);
        let ts = performance.now();
        const cond = job.condOverride ? { cond: g.upload(job.condOverride.data, 'cond'), nvalid: job.condOverride.nvalid, cached: false } :
          await this.getCond(job.prompt, (l) => emit(est.text * (l + 1) / 26, 'Reading the prompt'), job.check);
        timings.text = (performance.now() - ts) / 1000; if (cond.cached) total -= est.text; else finish(est.text, timings.text);
        result.textCached = cond.cached; result.nvalid = cond.nvalid;
        // ---- denoise (from startStep)
        phase = 'denoise'; mark('denoise', { step: startStep }); emit(0, 'Preparing', true); ts = performance.now();
        const S = await this.dit.prepare(cond, T, h, w);
        g.runner.flush(); g.free(cond.cond);
        lat = g.upload(latInit || job.noise0 || gaussianTokens(job.seed, T * h, w), 'latent');
        let nbuf = null;
        try {
          let best = Infinity;
          for (let k = startStep; k < steps; k++) {
            step = k + 1; const tk = performance.now(); emit(0, `Step ${k + 1} of ${steps}`, true); mark('denoise', { step: k + 1 });
            if (k + 1 < steps) nbuf = g.upload(job.noiseT ? job.noiseT[k] : gaussianTokens((job.seed ^ (0x9e3779b1 * (k + 1))) >>> 0, T * h, w), 'noise');
            await this.dit.step(S, k, lat, nbuf, { check: job.check, keepVelocity: job.keepVelocity, onBlock: (i) => emit(est.step * (i + 1) / 33, `Step ${k + 1} of ${steps}`) });
            if (nbuf) { g.runner.flush(); g.free(nbuf); nbuf = null; }
            const sec = (performance.now() - tk) / 1000; timings.steps.push(+sec.toFixed(2)); finish(est.step, sec);
            if (sec > 1.25 * best && this.ctx.warn && !result.hot) { result.hot = true; this.ctx.warn('HOT', `Step time grew from ${best.toFixed(1)} s to ${sec.toFixed(1)} s: the phone is probably throttling.`); }
            best = Math.min(best, sec);
            if (job.stepLatents) job.stepLatents.push(new Float32Array(await g.read(lat)));
            await saveCk(k + 1, lat);
          }
        } finally { if (nbuf) { g.runner.flush(); g.free(nbuf); } this.dit.free(S); }
        timings.denoise = (performance.now() - ts) / 1000;
      } else {
        lat = g.upload(latInit, 'latent'); emit(0, 'Resuming: decode only', true);
      }
      if (job.keepLatent) result.latent = new Float32Array(await g.read(lat));
      // ---- free everything but the latent, and wait until destruction is real
      this.te.freeCache(); this.te.tok = null; g.runner.flush(); await g.done();
      result.aliveBeforeDecodeMB = Math.round(g.alive / 1e6); g.resetPeak();
      // ---- decode: tiles -> OPFS frames file
      phase = 'decode'; mark('decode'); emit(0, 'Making the frames', true); let ts = performance.now();
      const fname = `${DIR}/frames.rgba`;
      await this.st.call('truncate', { name: fname, size: F * H * W * 4 });
      const sink = async (rgba, x0, y0, cw, ch, nf, f0) => { const ab = rgba.buffer; await this.st.call('writeRect', { name: fname, buf: ab, F: nf, f0, H, W, x0, y0, cw, ch }, [ab]); };
      const heapMB = () => (performance.memory && performance.memory.usedJSHeapSize ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
      const dec = await this.vae.decode(lat, T, h, w, sink, { check: job.check, onStage: (s) => {
        timings.tileLog.push(s);
        const hp = heapMB(); s.heapMB = hp;
        emit(est.decode * (s.tile + (s.subs ? s.sub / s.subs : 0)) / s.tiles, `Frames: tile ${s.tile + 1}/${s.tiles}${s.subs ? ` part ${s.sub}/${s.subs}` : ''} (GPU ${s.aliveMB} MB alive, peak ${s.peakMB}; page readback ${s.jsMB} MB in flight${hp != null ? `, JS heap ${hp} MB` : ''})`, true, { aliveMB: s.aliveMB, jsMB: s.jsMB, heapMB: hp, pool: s.pool });
      } });
      await this.st.call('flush', { name: fname });
      timings.decode = (performance.now() - ts) / 1000; timings.tiles = dec.tiles; timings.tileGrid = dec.grid; timings.decodePeakMB = Math.round(g.peak / 1e6); finish(est.decode, timings.decode);
      g.runner.flush(); g.free(lat); lat = null;
      // ---- encode: one frame at a time from OPFS
      phase = 'encode'; mark('encode'); emit(0, 'Saving the video', true); ts = performance.now();
      let fb = new ArrayBuffer(W * H * 4);
      const readFrame = async (f) => { const r = await this.st.call('read', { name: fname, at: f * W * H * 4, len: W * H * 4, buf: fb }, [fb]); fb = r.buf; return new Uint8Array(r.buf, 0, W * H * 4).slice(); };
      if (job.keepFrames) { result.readFrames = async (fn) => { for (let f = 0; f < F; f++) await fn(f, await readFrame(f)); }; result.readFrame = readFrame; }   // v026.3: one frame (the music video's handoff)
      if (!job.noEncode) { const e = await encodeMp4(readFrame, F, H, W, fps, (f) => emit(est.encode * (f + 1) / F, 'Saving the video')); result.mp4 = e.mp4; result.codec = e.codec; }
      timings.encode = (performance.now() - ts) / 1000;
      Object.assign(result, { frames: F, width: W, height: H, fps });
    } finally { g.runner.flush(); if (lat) g.free(lat); }
    if (!job.keepFrames) { try { await this.st.call('truncate', { name: `${DIR}/frames.rgba`, size: 0 }); await this.st.call('close', { name: `${DIR}/frames.rgba` }); } catch (e) { /* */ } }
    LS(VIDEO_CKPT, null);
    timings.upload = +((this.ctx.store.stats.uploadMs - up0) / 1000).toFixed(2);
    result.timings = timings; result.seconds = (performance.now() - t0) / 1000; result.peakMB = Math.round(g.peak / 1e6);
    phase = 'encode'; emit(total - done, 'done', true);
    LS('pocketvideo:running', null);
    return result;
  }
}

return { VIDEO_CKPT, encodeMp4, SanaVideoPipeline };
})();
// ---- engine.js
__M["engine.js"] = (() => {
const { ATTNF_P, ATTNF_V } = __M["ops/attention.js"];   // p0pc0rn v028
// Pocket Flux engine: FLUX.2 [klein] 4B text-to-image / image-to-image on WebGPU, pure JS + WGSL.  Public API = docs/ENGINE_API.md
// (engine_mock.js implements the same calls).  createEngine({model, packUrl, source: 'opfs'|'http', powerPreference, acc, attn}).
'use strict';
const { createGpu } = __M["core/gpu.js"];
const { WeightStore } = __M["core/store.js"];
const { gemm } = __M["ops/gemm.js"];
const { attention } = __M["ops/attention.js"];
const { KleinPipeline, sha } = __M["pipelines/klein.js"];
const { SanaVideoPipeline } = __M["pipelines/sana_video.js"];
const ENGINE_VERSION = '0.3.4';
const MAX_PIX = 1280 * 720, MAX_VIDEO_PIX = 1280 * 736;
/** model registry: the pack manifest's model.arch must match; each model keeps its own OPFS folder */
const MODELS = {
  'flux2-klein-4b': { arch: 'flux2-klein', kind: 'image', dir: 'pocketflux/pack', running: 'pocketflux:running', wipe: ['pocketflux/pack', 'pocketflux/cond', 'pocketflux/ckpt'], ls: ['pocketflux:cond', 'pocketflux:ckpt'] },
  'sanavideo2-5b': { arch: 'sana-video2', kind: 'video', dir: 'engine/sanavideo2-5b/pack', running: 'pocketvideo:running', wipe: ['engine/sanavideo2-5b'], ls: [] },
};
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
// The user agreement (0.3.4, p0pc0rn): no picture or video job runs until this browser holds the person's agreement to the CURRENT
// terms, recorded locally by the app after its copyright / trademark / likeness lesson ({terms, agreedAt} in localStorage, never sent
// anywhere). A new TERMS_VERSION means the lesson again. Builds that remove this check must not use the p0pc0rn name (TRADEMARKS.md).
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const noConsent = () => err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };

/** measure GEMM and attention throughput so every dispatch stays under the ~0.2 s watchdog guard (starts conservative) */
async function calibrate(g) {
  g.rate = { mm: 0.08e12, attn: 0.03e12, mem: 10e9 };
  const M = 1024, N = 3072, K = 3072, recs = (N / 64) * (K / 32), u = new Uint32Array(recs * 320);
  let s = 12345; for (let i = 0; i < u.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; u[i] = s >>> 0; }
  for (let r = 0; r < recs; r++) for (let j = 0; j < 64; j++) u[r * 320 + 256 + j] = 0x2000 | ((0xA800 | (j & 0x3f)) << 16);
  const h16 = (n) => { const h = new Uint16Array(n); for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; h[i] = (s & 0x83ff) | 0x3400; } return h; };
  const W = g.upload(u), X = g.upload(h16(M * K)), Y = g.buffer(M * N * 2), L = 1024, H = 8;
  const Q = g.upload(h16(H * L * 128)), O = g.buffer(L * H * 256);
  const time = async (fn, reps) => { fn(); await g.done(); const t0 = performance.now(); for (let i = 0; i < reps; i++) fn(); await g.done(); return (performance.now() - t0) / 1000 / reps; };
  try {
    const mm = (acc) => time(() => gemm(g, { w: { buf: W, off: 0, bytes: W._pf, enc: 'q4g32a.t64', rows: N, cols: K }, x: { buf: X }, M, N, K, epi: 'f16', y: { buf: Y }, acc }), 2);
    const t32 = await mm('f32'); g.rate.mm32 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t32);
    const t16 = await mm('f16'); g.rate.mm16 = Math.max(0.03e12, 0.8 * (2 * M * N * K) / t16);
    g.rate.mm = Math.min(g.rate.mm32, g.rate.mm16);
    const ta = await time(() => attention(g, { q: { buf: Q }, k: { buf: Q }, v: { buf: Q }, o: { buf: O }, Lq: L, Lk: L, Hq: H, Hkv: H, mode: 0 }), 2);
    g.rate.attn = Math.max(0.015e12, 0.8 * (4 * L * L * 128 * H) / ta);
    g.calib = { gemmF32Gflops: Math.round(2 * M * N * K / t32 / 1e9), gemmF16Gflops: Math.round(2 * M * N * K / t16 / 1e9), attnGflops: Math.round(4 * L * L * 128 * H / ta / 1e9) };
  } finally { [W, X, Y, Q, O].forEach((b) => g.free(b)); }
  return g.calib;
}

/** centre-crop to the target aspect and scale (canvas, high-quality smoothing) -> {data RGBA u8, width, height} */
async function prepareImage(image, w, h) {
  let bmp;
  try { bmp = image instanceof ImageBitmap ? image : await createImageBitmap(image); } catch (e) { throw err('BAD_IMAGE', 'Could not read that picture.'); }
  const ar = w / h, sw = Math.min(bmp.width, bmp.height * ar), sh = sw / ar, sx = (bmp.width - sw) / 2, sy = (bmp.height - sh) / 2;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}
async function toPNG(rgba, w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.convertToBlob ? c.convertToBlob({ type: 'image/png' }) : new Promise((res) => c.toBlob(res, 'image/png'));
}
/** reference size for i2i: 'full' = the output size, 'half' = half the output area (multiples of 16) */
function referenceSize(w, h, mode) {
  if (mode === 'full') return [w, h];
  const s = Math.SQRT1_2; return [Math.max(256, Math.round(w * s / 16) * 16), Math.max(256, Math.round(h * s / 16) * 16)];
}

async function createEngine(opts = {}) { const e = new Engine(opts); await e._init(); return e; }

class Engine {
  constructor(opts) {
    this.opts = Object.assign({ model: 'flux2-klein-4b', packUrl: './pack/', source: 'opfs', powerPreference: undefined, acc: null, attn: null }, opts);
    this.reg = MODELS[this.opts.model];
    if (!this.reg) throw err('UNSUPPORTED', 'unknown model ' + this.opts.model);
    if (!this.opts.dir) this.opts.dir = this.reg.dir;
    this.listeners = new Map(); this.job = null; this.state = 'idle'; this.gpu = null; this.pipe = null; this._installed = false; this.lastRun = null;
  }
  emit(name, data) { (this.listeners.get(name) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
  _setState(s) { this.state = s; this.emit('state', { state: s }); }
  async _init() {
    const c = { supported: false, reason: '', gpu: '', subgroups: false, maxBufferMB: 0, storageQuotaGB: 0, persisted: false };
    try {
      if (!navigator.gpu) c.reason = 'needs iOS 26 Safari (or another browser) with WebGPU';
      else {
        const ad = await navigator.gpu.requestAdapter(this.opts.powerPreference ? { powerPreference: this.opts.powerPreference } : undefined);
        if (!ad) c.reason = 'no WebGPU adapter';
        else {
          const i = ad.info || {};
          c.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' '); c.subgroups = ad.features.has('subgroups');
          c.maxBufferMB = Math.round(ad.limits.maxBufferSize / 1048576);
          if (!ad.features.has('shader-f16')) c.reason = 'this GPU has no 16-bit float shaders (shader-f16)';
          else if (ad.limits.maxBufferSize < 256 * 1048576) c.reason = 'GPU buffers are too small';
          else c.supported = true;
        }
      }
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); c.storageQuotaGB = +((e.quota || 0) / 1e9).toFixed(1); }
      if (navigator.storage && navigator.storage.persisted) c.persisted = await navigator.storage.persisted();
      if (c.supported && this.opts.source !== 'http' && !(navigator.storage && navigator.storage.getDirectory)) { c.supported = false; c.reason = 'this browser has no private file storage (OPFS)'; }
      if (c.supported && this.opts.source !== 'http' && c.storageQuotaGB && c.storageQuotaGB < 5) { c.supported = false; c.reason = 'not enough storage (needs about 5 GB free)'; }
    } catch (e) { c.reason = String(e && e.message || e); }
    this.caps = c;
    this.store = new WeightStore(null, { base: this.opts.packUrl, dir: this.opts.dir, source: this.opts.source });
    const run = LS(this.reg.running);
    if (run) {
      LS(this.reg.running, null);
      try { this.lastRun = JSON.parse(run); } catch (e) { this.lastRun = {}; }
      setTimeout(() => this.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last picture was interrupted (the phone ran out of memory or got hot). Try again, or pick a smaller size.', lastRun: this.lastRun }), 0);
    }
  }
  capabilities() { return Object.assign({}, this.caps); }
  async requestPersistentStorage() { try { const p = await navigator.storage.persist(); this.caps.persisted = p; return p; } catch (e) { return false; } }
  async _open() { if (!this.store.m) await this.store.open(); return this.store; }
  async status() {
    await this._open(); const s = this.store.status(); this._installed = s.complete;
    return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.store.m.pack_version };
  }
  async download({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A picture is being made.');
    if (this.state === 'downloading') throw err('BUSY', 'Already downloading.');
    this._setState('downloading');
    try {
      await this._open();
      const st0 = this.store.status();
      try { const e = await navigator.storage.estimate(); if (e.quota && e.quota - e.usage < st0.total - st0.have) this.emit('warning', { code: 'LOW_STORAGE', message: 'There may not be enough free storage for the model.' }); } catch (e) { /* */ }
      let last = 0;
      const r = await this.store.download({ signal, parallel, onProgress: (p) => {
        const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
        if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: p.shard });
      } });
      this._installed = r.complete;
      return Object.assign(await this.status(), { downloadedBytes: this.store.stats.downloadBytes, seconds: this.store.stats.downloadSec });
    } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; } finally { this._setState('idle'); }
  }
  async deleteModel() {
    if (this.job) throw err('BUSY', 'A picture is being made.');
    await this._open();
    if (!this.store.http) { await this.store.st.start(); for (const d of this.reg.wipe) await this.store.st.call('remove', { name: d }); }
    this.store.state = { pack_version: this.store.m.pack_version, done: {} }; this._installed = false;
    for (const k of this.reg.ls) LS(k, null); if (this.pipe) this.pipe.condMem = [];
  }
  models() { return [{ id: this.opts.model, kind: this.reg.kind, installed: this._installed }]; }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  off(n, fn) { this.listeners.set(n, (this.listeners.get(n) || []).filter((f) => f !== fn)); }
  cancel() { if (this.job) this.job.abort(); }
  /** optional (test tools): create the GPU device + calibrate now; returns {gpu, calib, tune} */
  async load() { if (this.job) throw err('BUSY', 'Busy.'); await this._load(); return { gpu: this.gpu.describe(), calib: this.gpu.calib, tune: this.gpu.tune }; }
  /** optional (test tools): {acc: 'f16'|'f32' (DiT GEMM accumulate), attn: {BQ, pv16, s16}} - applies from the next job */
  /** video: the unfinished clip of the last run ({prompt, width, height, frames, seed, step}; step 4 = decode only) or null.
   *  textToVideo with the same prompt / size / frames / seed resumes it automatically. */
  videoCheckpoint() { return this.reg.kind === 'video' ? SanaVideoPipeline.checkpoint() : null; }
  tune(o = {}) {
    if (o.decodeBudgetMB) { this.opts.decodeBudgetMB = o.decodeBudgetMB; if (this.pipe && this.pipe.vae) this.pipe.vae.budget = o.decodeBudgetMB * 1e6; }
    if (o.acc) this.opts.acc = o.acc; if (o.attn) this.opts.attn = o.attn; if (this.gpu) { if (o.acc) this.gpu.tune.acc = o.acc; if (o.attn) this.gpu.tune.attn = Object.assign({}, this.gpu.tune.attn, o.attn); } return this.gpu ? this.gpu.tune : this.opts; }

  async _gpu() {
    const g = await createGpu({ powerPreference: this.opts.powerPreference || 'high-performance', onLost: () => this.emit('gpu-lost', {}) });
    g.tune = { acc: this.opts.acc || 'f16', vaeAcc: this.opts.vaeAcc || 'f16', attn: this.opts.attn || { BQ: 64, sg: g.subgroups && g.sgMin >= 8, pv16: true },
      attnF: this.opts.attnF !== undefined ? this.opts.attnF : ATTNF_P, attnF256: this.opts.attnF256 !== undefined ? this.opts.attnF256 : ATTNF_V };   // v028: the phone-tuned attention
    return g;
  }
  async _load() {
    await this._open();
    if (!this.store.status().complete) throw err('NOT_DOWNLOADED', 'Download the model first.');
    this._installed = true;
    if (!this.gpu || this.gpu.lost) {
      const old = this.gpu; this.gpu = await this._gpu();
      if (old && old.calib) this.gpu.rate = old.rate; else await calibrate(this.gpu);
      if (this.pipe) this.pipe.bind(this.gpu);
    }
    if (!this.store.http) await this.store.st.start();
    if (!this.pipe) {
      const arch = this.store.m.model && this.store.m.model.arch;
      if (arch !== this.reg.arch) throw err('UNSUPPORTED', `pack is ${arch}, engine model ${this.opts.model} needs ${this.reg.arch}`);
      const ctx = { gpu: this.gpu, store: this.store, emit: (p) => this.emit('progress', p), warn: (code, message) => this.emit('warning', { code, message }),
        vaeOpts: Object.assign(this.opts.decodeBudgetMB ? { budgetBytes: this.opts.decodeBudgetMB * 1e6 } : {}, this.opts.vaeChunk != null ? { chunk: this.opts.vaeChunk } : {},
          this.opts.vaePlan ? { plan: this.opts.vaePlan } : {}, this.opts.picAcc ? { picAcc: this.opts.picAcc } : {}) };   // v029 test tools: vaeChunk 0 = the v028 clip decoder, vaePlan = forced tiles
      this.pipe = arch === 'sana-video2' ? new SanaVideoPipeline(ctx) : new KleinPipeline(ctx);
    }
    return this.pipe;
  }
  textToImage(o) { if (this.reg.kind !== 'image') return Promise.reject(err('UNSUPPORTED', 'this model makes videos: use textToVideo')); return this._run('t2i', o || {}); }
  /** {prompt, width=832, height=480, frames=81 (8k+1), seed, fps=16, onProgress, signal} -> {blob (video/mp4), url, frames, width, height, fps, seed, seconds, timings} */
  async textToVideo(o = {}) {
    if (!consented()) throw noConsent();
    if (this.reg.kind !== 'video') throw err('UNSUPPORTED', 'this model makes pictures: use textToImage');
    if (this.job) throw err('BUSY', 'A video is already being made.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    const prompt = String(o.prompt || '').trim();
    if (!prompt) throw err('EMPTY_PROMPT', 'Type what you want to see.');
    const w = o.width || 832, h = o.height || 480, F = o.frames || 81, seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w % 32 || h % 32 || w < 256 || h < 256 || w * h > MAX_VIDEO_PIX) throw err('BAD_SIZE', 'Width and height must be multiples of 32, at most 1280x736 pixels.');
    if (!Number.isInteger(F) || F < 9 || F > 121 || (F - 1) % 8) throw err('BAD_SIZE', 'frames must be 8k + 1 (9 .. 121).');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now();
    try {
      LS(this.reg.running, JSON.stringify({ phase: 'load', w, h, frames: F, t: Date.now() }));
      if (o.onProgress) o.onProgress({ phase: 'load', frac: 0, step: 0, steps: 4, etaSeconds: null, message: 'Preparing' });
      await this._load();
      const check = () => { if (ctl.signal.aborted) throw abortErr(); if (this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
      let r;
      try {
        r = await this.pipe.run({ prompt, width: w, height: h, frames: F, seed, fps: o.fps, check, onProgress: o.onProgress,
          noResume: o.resume === false, noise0: o._noise0, noiseT: o._noiseT, condOverride: o._cond, keepVelocity: o._keepVelocity, stepLatents: o._stepLatents, keepLatent: o._keepLatent, keepFrames: o._keepFrames, noEncode: o._noEncode });
      } catch (e) {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
        if (this.gpu && this.gpu.lost) { this.gpu = null; throw err('GPU_LOST', 'The GPU was reset. Try again.'); }
        if (e && e.code) throw e;
        const m = String(e && e.message || e) + ' ' + String(this.gpu && this.gpu.lastError || '');
        if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a smaller size or fewer frames.');
        throw e;
      }
      const blob = r.mp4 ? new Blob([r.mp4], { type: 'video/mp4' }) : null;
      return { blob, url: blob ? URL.createObjectURL(blob) : null, frames: r.frames, width: r.width, height: r.height, fps: r.fps, seed, prompt, codec: r.codec,
        seconds: (performance.now() - t0) / 1000, timings: Object.assign({ load: (performance.now() - t0) / 1000 - r.seconds }, r.timings), peakMB: r.peakMB, textCached: r.textCached, resumedFromStep: r.resumedFromStep, aliveBeforeDecodeMB: r.aliveBeforeDecodeMB,
        gpu: this.gpu.describe(), calib: this.gpu.calib, tune: this.gpu.tune, gpuPool: this.gpu.poolStats(), _r: r };
    } finally { this.job = null; LS(this.reg.running, null); this._setState('idle'); }
  }
  imageToImage(o) { return this._run('i2i', o || {}); }
  async _run(kind, o) {
    if (!consented()) throw noConsent();
    if (this.job) throw err('BUSY', 'A picture is already being made.');
    if (this.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (!this.caps.supported) throw err('UNSUPPORTED', this.caps.reason || 'This device cannot run the engine.');
    const prompt = String(o.prompt || '').trim();
    if (!prompt) throw err('EMPTY_PROMPT', 'Type what you want to see.');
    const w = o.width || 1280, h = o.height || 720, steps = o.steps || 4, seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w % 16 || h % 16 || w < 256 || h < 256 || w * h > MAX_PIX) throw err('BAD_SIZE', 'Width and height must be multiples of 16, at most 1280x720 pixels.');
    if (!(steps >= 1 && steps <= 8)) throw err('BAD_SIZE', 'steps must be 1..8');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this._setState('working');
    const t0 = performance.now();
    try {
      const prog = (p) => { if (o.onProgress) try { o.onProgress(p); } catch (e) { /* */ } };
      prog({ phase: 'load', frac: 0, step: 0, steps, etaSeconds: null, message: 'Preparing' });
      LS('pocketflux:running', JSON.stringify({ phase: 'load', kind, w, h, steps, t: Date.now() }));
      const pipe = await this._load();
      const check = () => { if (ctl.signal.aborted) throw abortErr(); if (this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
      let image = null, imageHash = '';
      if (kind === 'i2i') {
        if (!o.image) throw err('BAD_IMAGE', 'Pick a picture first.');
        const [rw, rh] = referenceSize(w, h, o.reference || 'half');
        image = await prepareImage(o.image, rw, rh); imageHash = await sha(image.data);
      }
      check();
      let r = null;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await this.pipe.run({ kind, prompt, width: w, height: h, seed, steps, image, imageHash, check, onProgress: prog,
            noiseTokens: o._noiseTokens, condOverride: o._cond, refTokens: o._refTokens, keepLatent: o._keepLatent, rgbFloat: o._rgbFloat, stepLatents: o._stepLatents, forceBand: o._forceBand });
          break;
        } catch (e) {
          if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
          if (this.gpu && this.gpu.lost && attempt === 0) { this.emit('warning', { code: 'GPU_LOST', message: 'The GPU was reset; resuming.' }); this.gpu = null; await this._load(); continue; }
          if (this.gpu && this.gpu.lost) throw err('GPU_LOST', 'The GPU was reset. Try again.');
          const m = String(e && e.message || e) + ' ' + String(this.gpu && this.gpu.lastError || '');
          if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a smaller size.');
          throw e;
        }
      }
      const blob = await toPNG(r.rgba, r.width, r.height);
      const t = r.timings;
      return { blob, url: URL.createObjectURL(blob), width: r.width, height: r.height, seed, steps, prompt, seconds: (performance.now() - t0) / 1000,
        timings: { text: t.text, denoise: t.denoise, decode: t.decode, encode: t.encode, steps: t.steps, upload: t.upload, load: (performance.now() - t0) / 1000 - r.seconds },
        peakMB: r.peakMB, textCached: r.textCached, resumedFromStep: r.resumedFromStep, gpu: this.gpu.describe(), calib: this.gpu.calib, tune: this.gpu.tune, gpuPool: this.gpu.poolStats(),
        _latent: r.latent, _rgb: r.rgb, _refTokens: r.refTokens };
    } catch (e) {
      if (e && e.name === 'AbortError') LS('pocketflux:ckpt', null);
      throw e;
    } finally { this.job = null; LS('pocketflux:running', null); this._setState('idle'); }
  }
}

return { ENGINE_VERSION, MODELS, calibrate, referenceSize, createEngine };
})();
// ---- i2v/still_encoder.js
__M["i2v/still_encoder.js"] = (() => {
// LTX-2.3 STILL encoder (p0pc0rn i2v / FLF spec, section 3): one picture -> one SANA-Video 2.0 latent frame.
// The causal 3-D encoder, run on a single frame, is exactly a 2-D network (every 3x3x3 conv sees frame 0 in all three time taps, so the
// pack stores W2d = sum_kt W3d; the temporal space-to-depth only duplicates channels).  Ops: the engine's gemm 'conv3' kind with T = 1
// (time index clamps to frame 0) + pixstats (PixelNorm + SiLU fused into the next conv, residual adds in the epilogue, exactly the
// decoder's ResBlock), plus ONE new kernel here: s2dres (downsampler space-to-depth + group-mean residual).  f16 activations; the
// stream after down3 is stored /act_scale (the pack pre-scales those convs; PixelNorm makes it exact).  ~0.56 TFLOP per 832x480 still.
// Accumulate in f32 ALWAYS: f16 partial sums fail the parity bar (latent rel 1.19e-2 > 1e-2 on a desktop test GPU); on Apple f32 GEMMs run ~0.9x f16.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { pixstats } = __M["ops/video.js"];
const { P, toF16, fromF16 } = __M["core/gpu.js"];
const S2DRES = `
enable f16;
struct P { Ho: u32, Wo: u32, Ci: u32, Cc: u32, Co: u32, sh: u32, sw: u32, PP: u32, G: u32, rs: f32, n2: u32, pad: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> X: array<f16>;          // downsampler input x  [Ho*sh][Wo*sw][Ci]
@group(0) @binding(2) var<storage, read> C: array<f16>;          // conv(x)              [Ho*sh][Wo*sw][Cc]
@group(0) @binding(3) var<storage, read_write> Y: array<u32>;    // output f16 pairs     [Ho][Wo][Co]
// channel j of a (st, sh, sw) space-to-depth = ((c * st + pt) * sh + ph) * sw + pw; one still = identical time slices (pt ignored)
fn tap(j: u32, Hs: u32) -> vec3<u32> { let r = j % p.PP; let SS = p.sh * p.sw; return vec3<u32>(j / p.PP, (r % SS) / p.sw, r % p.sw); }
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = g.x + g.y * nw.x * 256u; if (i >= p.n2) { return; }
  let C2 = p.Co / 2u; let j0 = (i % C2) * 2u; let vox = i / C2; let ox = vox % p.Wo; let oy = vox / p.Wo; let Wi = p.Wo * p.sw;
  var o = vec2<f32>(0.0);
  for (var e = 0u; e < 2u; e = e + 1u) {
    let j = j0 + e; let t = tap(j, 0u);
    let v = f32(C[((oy * p.sh + t.y) * Wi + ox * p.sw + t.z) * p.Cc + t.x]);
    var s = 0.0;
    for (var q = 0u; q < p.G; q = q + 1u) { let u = tap(j * p.G + q, 0u); s = s + f32(X[((oy * p.sh + u.y) * Wi + ox * p.sw + u.z) * p.Ci + u.x]); }
    o[e] = v + (s / f32(p.G)) * p.rs;
  }
  Y[i] = pack2x16float(o);
}`;
const bw = (b, off = 0) => ({ buffer: b, offset: off, size: Math.floor((b._pf - off) / 16) * 16 });
function s2dres(g, a) {
  const pipe = g.pipeline('i2v.s2dres', () => S2DRES), n2 = a.Ho * a.Wo * a.Co / 2, wgs = Math.ceil(n2 / 256);
  const PP = a.st * a.sh * a.sw, G = (a.Ci * PP) / a.Co;
  g.runner.dispatch(pipe, [bw(a.x), bw(a.c), bw(a.y)], P().u32(a.Ho).u32(a.Wo).u32(a.Ci).u32(a.Cc).u32(a.Co).u32(a.sh).u32(a.sw).u32(PP).u32(G).f32(a.rs || 1).u32(n2).u32(0).ab,
    [Math.min(wgs, 65535), Math.ceil(wgs / 65535)], n2 * (2 + G) * 4 / g.rate.mem);
}

/** JS: RGBA8 [H][W][4] -> f16 patch tensor [H/4][W/4][64] (channel c*16 + dx*4 + dy, value px/127.5 - 1; channels 48..63 zero) */
function patchify(rgba, W, H) {
  const Wp = W / 4, Hp = H / 4, out = new Float32Array(Hp * Wp * 64);
  for (let py = 0; py < Hp; py++) for (let px = 0; px < Wp; px++) {
    const o = (py * Wp + px) * 64;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const s = ((4 * py + dy) * W + 4 * px + dx) * 4;
      for (let c = 0; c < 3; c++) out[o + c * 16 + dx * 4 + dy] = rgba[s + c] / 127.5 - 1;
    }
  }
  return toF16(out);
}

class LTX2StillEncoder {
  /** store: a WeightStore over the ltx2-still-encoder pack (its own OPFS folder) */
  constructor(gpu, store, opts = {}) { this.g = gpu; this.store = store; this.cfg = store.m.model.enc; this.acc = opts.acc || null; }
  conv(sh, name, x, Cout, o) {
    const w = sh.t(name + '.weight'), b = { buf: sh.buf, off: sh.t(name + '.bias').off / 4 };
    if (w.cols !== 9 * x.C) throw new Error(`still encoder: ${name} K ${w.cols} != 9 x ${x.C}`);
    gemm(this.g, { acc: this.acc || 'f32', w, x: { buf: x.buf }, M: x.H * x.W, N: Cout, K: 9 * x.C, epi: 'bias', ev: b, res: !!o.res,
      stats: o.pn ? { buf: o.pn } : undefined, y: { buf: o.y }, conv: { kind: 'conv3', Hi: x.H, Wi: x.W, Ci: x.C, Ho: x.H, Wo: x.W, stride: 1, pn: !!o.pn } });
  }
  drop(...bs) { this.g.runner.flush(); for (const b of bs) if (b) this.g.free(b); }
  async res(sh, pre, x, n, R, check) {
    const g = this.g, V = x.H * x.W;
    for (let r = 0; r < n; r++) {
      const hb = g.buffer(V * x.C * 2, 'enc.h');
      pixstats(g, { x: { buf: x.buf }, r: { buf: R }, V, C: x.C });
      this.conv(sh, `${pre}.resnets.${r}.conv1`, x, x.C, { pn: R, y: hb });
      pixstats(g, { x: { buf: hb }, r: { buf: R }, V, C: x.C });
      this.conv(sh, `${pre}.resnets.${r}.conv2`, { buf: hb, H: x.H, W: x.W, C: x.C }, x.C, { pn: R, y: x.buf, res: true });
      this.drop(hb);
      if (check) check();
    }
  }
  /** rgba: Uint8(Clamped)Array W*H*4 (already the video size) -> {tokens: Float32Array [(H/32)*(W/32)][128] normalised latent, ms, uploadMs, peakMB} */
  async encode(rgba, W, H, opts = {}) { const r = await this.encodeMany([rgba], W, H, opts); return Object.assign({}, r, { tokens: r.tokens[0] }); }
  /** several stills of one size, each weight shard read ONCE for all of them (FLF: 2 stills for the price of one upload).
   *  opts {check(), onStage(i, n)} -> {tokens: [Float32Array], h, w, ms, uploadMs, peakMB} */
  async encodeMany(list, W, H, opts = {}) {
    const g = this.g, st = this.store, c = this.cfg, t0 = performance.now(), up0 = st.stats.uploadMs;
    if (W % 32 || H % 32) throw new Error('still encoder: W and H must be multiples of 32');
    let xs = list.map((rgba) => ({ buf: g.upload(patchify(rgba, W, H), 'enc.patch'), H: H / 4, W: W / 4, C: c.in_ch_padded })), R = null, cur = null;
    const stages = c.stages.length + 2;
    const shard = async (name) => { if (cur && cur.name === name) return cur; if (cur) { g.runner.flush(); await g.device.queue.onSubmittedWorkDone(); st.release(cur); } cur = await st.upload(name); return cur; };
    try {
      let sh = await shard(c.conv_in.shard);
      xs = xs.map((x) => { const y0 = g.buffer(x.H * x.W * c.conv_in.ch * 2, 'enc.x'); this.conv(sh, 'encoder.conv_in', x, c.conv_in.ch, { y: y0 }); this.drop(x.buf); return { buf: y0, H: x.H, W: x.W, C: c.conv_in.ch }; });
      if (opts.onStage) opts.onStage(0, stages);
      for (let bi = 0; bi < c.stages.length; bi++) {
        const s = c.stages[bi]; sh = await shard(s.shard);
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i];
          R = g.buffer(x.H * x.W * 4, 'enc.rstd');
          await this.res(sh, `encoder.down_blocks.${bi}`, x, s.res, R, opts.check);
          this.drop(R); R = null;
          const [st_, sh_, sw_] = s.down, PP = st_ * sh_ * sw_, Cc = s.out / PP;
          const cb = g.buffer(x.H * x.W * Cc * 2, 'enc.dsconv');
          this.conv(sh, `encoder.down_blocks.${bi}.downsamplers.0.conv`, x, Cc, { y: cb });
          const Ho = x.H / sh_, Wo = x.W / sw_, yb = g.buffer(Ho * Wo * s.out * 2, 'enc.x');
          s2dres(g, { x: x.buf, c: cb, y: yb, Ho, Wo, Ci: x.C, Cc, Co: s.out, st: st_, sh: sh_, sw: sw_, rs: s.res_scale });
          this.drop(cb, x.buf); xs[i] = { buf: yb, H: Ho, W: Wo, C: s.out };
        }
        g.runner.flush(); await g.device.queue.onSubmittedWorkDone(); if (opts.check) opts.check();
        if (opts.onStage) opts.onStage(bi + 1, stages);
      }
      sh = await shard(c.mid.shard);
      const mean = new Float32Array(await g.read(sh.buf, sh.t('latents_mean').off, 512)), std = new Float32Array(await g.read(sh.buf, sh.t('latents_std').off, 512)), sf = c.scaling_factor || 1;
      const tokens = [];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        R = g.buffer(x.H * x.W * 4, 'enc.rstd');
        await this.res(sh, 'encoder.mid_block', x, c.mid.res, R, opts.check);
        const ob = g.buffer(x.H * x.W * c.conv_out.ch * 2, 'enc.out');
        pixstats(g, { x: { buf: x.buf }, r: { buf: R }, V: x.H * x.W, C: x.C });
        this.conv(sh, 'encoder.conv_out', x, c.conv_out.ch, { pn: R, y: ob });
        const raw = fromF16(new Uint16Array(await g.read(ob))), n = x.H * x.W, tok = new Float32Array(n * 128);
        for (let p = 0; p < n; p++) for (let k = 0; k < 128; k++) tok[p * 128 + k] = (raw[p * 128 + k] - mean[k]) * sf / std[k];
        this.drop(ob, R); R = null; tokens.push(tok);
      }
      g.runner.flush(); await g.device.queue.onSubmittedWorkDone(); st.release(cur); cur = null;
      if (opts.onStage) opts.onStage(stages, stages);
      return { tokens, h: H / 32, w: W / 32, ms: performance.now() - t0, uploadMs: st.stats.uploadMs - up0, peakMB: Math.round(g.peak / 1e6) };
    } finally { for (const x of xs) this.drop(x && x.buf); this.drop(R); if (cur && cur.buf) st.release(cur); await g.done().catch(() => {}); }
  }
}

return { patchify, LTX2StillEncoder };
})();
// ---- i2v/sana_dit_cond.js
__M["i2v/sana_dit_cond.js"] = (() => {
// SANA-Video 2.0 DiT with FRAME CONDITIONING (p0pc0rn i2v / FLF spec, sections 1-2).
// The official TI2V mechanism (inference_sana_video.py task=ltx + LTXFlowEuler), applied to the 4-step DMD student:
//   - pinned latent frames hold the still's latent at every stage and are never updated by the sampler;
//   - the model gets a PER-FRAME timestep: pinned frames run at t = 0, the rest at the stage's t (frame-aware AdaLN: every block's
//     shift / scale / gate and the final layer's shift / scale come from that frame's own time embedding).
// Tokens are (f, h, w) row-major, so a latent frame is a contiguous row range: every modulated GEMM (qkv, output gate, beta, proj gate,
// SwiGLU in, down gate, final layer) runs once per row segment with that segment's modulation.  Same kernels as SanaDiT; attention,
// cross-attention and the depth aggregation are unchanged.  _block / step are SanaDiT's (models/sana_dit.js, engine 0.3.4) with only the
// modulated calls split by segment; keep them in sync when sana_dit.js changes.
'use strict';
const { gemm } = __M["ops/gemm.js"];
const { attention } = __M["ops/attention.js"];
const { rowstats, layout } = __M["ops/misc.js"];
const { laprep, kvstate, attn256, attnres } = __M["ops/video.js"];
const { rmshead, vop } = __M["ops/video2.js"];
const { SanaDiT } = __M["models/sana_dit.js"];
const D = 2560, MLP = 10240, MODN = 6 * D, LDG = 2624, f = Math.fround, neg = (n) => (-n) >>> 0;

class SanaDiTCond extends SanaDiT {
  constructor(gpu, store, opts = {}) {
    super(gpu, store, opts);
    this.cfg = Object.assign({}, this.cfg, { timesteps: this.cfg.timesteps.concat([0]) });   // row `steps` = the t = 0 (pinned frame) embedding
    this.steps = this.cfg.sigmas.length; this.condRow = this.steps;
  }
  /** pins: [{frame (latent index, negative = from the end)}]; -> S with S.segs [{r0, r1, cond}] (row ranges in tokens) */
  async prepare(cond, T, H, W, pins = []) {
    const S = await super.prepare(cond, T, H, W), hw = H * W;
    const frames = new Set(pins.map((p) => (p.frame < 0 ? T + p.frame : p.frame)));
    S.segs = [];
    for (let fr = 0; fr < T; fr++) {
      const c = frames.has(fr), last = S.segs[S.segs.length - 1];
      if (last && last.cond === c) last.r1 += hw; else S.segs.push({ r0: fr * hw, r1: (fr + 1) * hw, cond: c });
    }
    S.pinFrames = Array.from(frames).sort((a, b) => a - b); S.hw = hw;
    S.modc = this.g.buffer(MODN * 4, 'dit.modc'); S.bufs.push(S.modc);
    return S;
  }
  _block(S, sh, b, k, first, active) {
    const g = this.g, N = S.N, p = `blocks.${b}.`, t = (n) => sh.t(p + n), lin = !this.cfg.anchors.includes(b);
    const acc = this.acc || (g.tune && g.tune.acc) || 'f32', bias = (n) => ({ buf: sh.buf, off: t(n).off / 4 }), K = S.keep;
    const ac = (cls) => (g.tune && g.tune.accClass && g.tune.accClass[cls]) || (cls === 'crosskv' ? 'f32' : acc);
    const slot = (i) => ({ buf: S.src, off: i * N * D * 2 }), R1 = N * D * 2;
    const O = { buf: S.qkv, off: 0 }, X16 = { buf: S.qkv, off: R1 }, QC = { buf: S.qkv, off: 2 * R1 }, DL = { buf: S.QH, off: 0 }, OCQ = { buf: S.QH, off: 2 * R1 }, OC = { buf: S.QH, off: 0 };
    const castPartial = () => layout(g, { op: 'cast2d', n: N * D, xf: { buf: S.partial }, yh: slot(active), a: D, b: D, c: 0, d: D, e: 0 });
    const aggregate = (proj, ns) => attnres(g, { src: { buf: S.src }, q: { buf: K.buf, off: K.t('attn_res.' + proj + '.weight').off / 4 }, out: { buf: S.hidden }, N, D, ns });
    vop(g, { op: 'addvec', n: MODN, af: { buf: sh.buf }, a: t('scale_shift_table').off / 4, ah: { buf: S.t0 }, b: k * MODN, c: MODN, yf: { buf: S.mod } });
    vop(g, { op: 'addvec', n: MODN, af: { buf: sh.buf }, a: t('scale_shift_table').off / 4, ah: { buf: S.t0 }, b: this.condRow * MODN, c: MODN, yf: { buf: S.modc } });
    const segs = S.segs, mb = (s) => (s.cond ? S.modc : S.mod);
    // one modulated GEMM per segment: rows [r0, r1); xo/yo give the byte offsets of row r0 in x / y
    const seg = (fn) => { for (const s of segs) fn(s, s.r1 - s.r0); };
    // ---- attention sublayer
    if (!first) castPartial();
    aggregate('attn_proj', first ? active : active + 1);
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    seg((s, M) => {
      const lnx = { buf: S.hidden, off: s.r0 * D * 4, ld: D, mode: 'lnmod' }, lnp = { buf: mb(s), off: D, stride: neg(D) }, stt = { buf: S.stats, off: s.r0 };
      gemm(g, { acc: ac('qkv'), w: t('attn.qkv.weight'), x: lnx, stats: stt, pv: lnp, M, N: 3 * D, K: D, epi: 'f16', y: { buf: S.qkv, off: s.r0 * 3 * D * 2, ld: 3 * D } });
      gemm(g, { acc: ac('gate'), w: t('attn.output_gate.weight'), x: lnx, stats: stt, pv: lnp, M, N: D, K: D, epi: 'bias', ev: bias('attn.output_gate.bias'), y: { buf: S.G, off: s.r0 * LDG * 2, ld: LDG } });
      if (lin) {
        const bw = t('attn.beta_proj.weight');
        gemm(g, { acc: ac('gate'), w: Object.assign({}, bw, { rows: 20, cols: D }), x: lnx, stats: stt, pv: lnp, M, N: 20, K: D, epi: 'bias', ev: bias('attn.beta_proj.bias'), y: { buf: S.G, off: s.r0 * LDG * 2, ld: LDG, n0: D } });
      }
    });
    const qkw = { buf: sh.buf, off: t('attn.q_norm.weight').off };
    if (t('attn.k_norm.weight').off !== qkw.off + D * 4) throw new Error('pack: q_norm / k_norm must be adjacent');
    if (lin) {
      laprep(g, { N, D, hd: 128, qkv: { buf: S.qkv }, g: { buf: S.G, ld: LDG, off: D }, w: qkw, rope: { buf: S.rope1 }, out: { buf: S.QH }, eps: 1e-5 });
      kvstate(g, { N, H: 20, qkvh: { buf: S.QH }, kv: { buf: S.KV }, part: S.part, splits: S.splits });
      for (let h = 0; h < 20; h++) gemm(g, { acc: 'f32', w: { buf: S.KV, off: h * 32768, bytes: 32768, enc: 'f16', rows: 128, cols: 128 }, x: { buf: S.QH, off: h * N * 256, ld: 128 },
        M: N, N: 128, K: 128, epi: 'onormgate', ev: bias('attn.o_norm.weight'), gt: { buf: S.G }, heads: { Ltot: LDG, eps: 1e-5 / (N * N) }, y: { buf: O.buf, off: 0, ld: D, n0: h * 128 } });
    } else {
      laprep(g, { N, D, hd: 256, qkv: { buf: S.qkv }, w: qkw, rope: { buf: S.rope2 }, out: { buf: S.QH }, eps: 1e-5 });
      attn256(g, { q: { buf: S.QH, off: 0 }, k: { buf: S.QH, off: 10 * N * 512 }, v: { buf: S.QH, off: 20 * N * 512 }, o: { buf: O.buf, off: 0, ld: D }, Lq: N, Lk: N, Hq: 10, Hkv: 10, mode: 0, scale: 1 / 16 });
      vop(g, { op: 'mulsig', n: N * D / 2, yu: { buf: O.buf, off: 0, size: R1 }, ah: { buf: S.G }, a: D, b: LDG });
    }
    seg((s, M) => gemm(g, { acc: ac('proj'), w: t('attn.proj.weight'), x: { buf: O.buf, off: s.r0 * D * 2, size: M * D * 2, ld: D }, M, N: D, K: D, epi: 'resadd', store: true,
      ev: { buf: mb(s), off: 2 * D }, bv: bias('attn.proj.bias'), y: { buf: DL.buf, off: s.r0 * D * 4, ld: D } }));
    vop(g, { op: 'add32', n: N * D, af: { buf: DL.buf, off: 0, size: N * D * 4 }, yf: { buf: S.partial }, a: first ? 1 : 0 });
    // ---- cross-attention on hidden + delta (unmodulated)
    vop(g, { op: 'add16', n: N * D / 2, af: { buf: S.hidden }, bf: { buf: DL.buf, off: 0, size: N * D * 4 }, yu: { buf: X16.buf, off: X16.off, size: R1 } });
    gemm(g, { acc: ac('crossq'), w: t('cross_attn.q_linear.weight'), x: { buf: X16.buf, off: X16.off, size: R1, ld: D }, M: N, N: D, K: D, epi: 'bias', ev: bias('cross_attn.q_linear.bias'), y: { buf: OCQ.buf, off: OCQ.off, size: R1, ld: D } });
    rmshead(g, { M: N, D, hd: 128, x: { buf: OCQ.buf, off: OCQ.off, ld: D }, w: { buf: sh.buf, off: t('cross_attn.q_norm.weight').off / 4 }, eps: 1e-6, out: { buf: QC.buf, off: QC.off }, Ltot: N });
    gemm(g, { acc: ac('crosskv'), w: t('cross_attn.kv_linear.weight'), x: { buf: S.y, ld: D }, M: 300, N: 2 * D, K: D, epi: 'bias', ev: bias('cross_attn.kv_linear.bias'), y: { buf: S.kvc, ld: 2 * D } });
    rmshead(g, { M: 300, D, hd: 128, x: { buf: S.kvc, ld: 2 * D, c0: 0 }, w: { buf: sh.buf, off: t('cross_attn.k_norm.weight').off / 4 }, eps: 1e-6, out: { buf: S.KC }, Ltot: 300 });
    rmshead(g, { M: 300, D, hd: 128, x: { buf: S.kvc, ld: 2 * D, c0: D }, out: { buf: S.VC }, Ltot: 300 });
    attention(g, { q: { buf: QC.buf, off: QC.off, size: R1 }, k: { buf: S.KC }, v: { buf: S.VC }, o: { buf: OC.buf, off: 0, size: R1, ld: D }, Lq: N, Lk: 300, Hq: 20, Hkv: 20, mode: 2, nvalid: S.nvalid,
      cfg: { BQ: 64, sg: false, pv16: true } });
    gemm(g, { acc: ac('crossproj'), w: t('cross_attn.proj.weight'), x: { buf: OC.buf, off: 0, size: R1, ld: D }, M: N, N: D, K: D, epi: 'resadd', bv: bias('cross_attn.proj.bias'), y: { buf: S.partial, ld: D } });
    // ---- MLP sublayer (modulated in and out, per segment, chunked inside each segment)
    castPartial();
    aggregate('mlp_proj', active + 1);
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    for (const s of segs) {
      for (let r = s.r0; r < s.r1; r += this.chunk) {
        const n = Math.min(this.chunk, s.r1 - r);
        gemm(g, { acc: ac('up'), w: t('mlp.gate_up_proj.weight'), x: { buf: S.hidden, off: r * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: S.stats, off: r }, pv: { buf: mb(s), off: 4 * D, stride: neg(D) },
          M: n, N: 2 * MLP, K: D, wr0: 0, wr1: MLP, epi: 'swiglu', bv: { buf: sh.buf, off: t('mlp.gate_up_proj.bias').off / 4, up: MLP }, y: { buf: S.m, ld: MLP } });
        gemm(g, { acc: ac('down'), w: t('mlp.down_proj.weight'), x: { buf: S.m, ld: MLP }, M: n, N: D, K: MLP, epi: 'resadd', ev: { buf: mb(s), off: 5 * D }, bv: bias('mlp.down_proj.bias'), y: { buf: S.partial, off: r * D * 4, ld: D } });
      }
    }
  }

  /** one conditioned DMD step k.  latent f32 tokens [N][128] in place; pins [{frame, buf (f32 [hw][128] GPU buffer)}] are written back
   *  after the update (pinned frames are never changed by the sampler).  opts {onBlock(i), check(), keepVelocity} */
  async step(S, k, latent, noise, opts = {}, pins = []) {
    const g = this.g, st = this.store, N = S.N, K = S.keep, c = this.cfg;
    layout(g, { op: 'cast16', n: N * 128, xf: { buf: latent }, yh: { buf: S.tok } });
    gemm(g, { acc: 'f32', w: K.t('x_embedder.proj.weight'), x: { buf: S.tok, ld: 128 }, M: N, N: D, K: 128, epi: 'bias', ev: { buf: K.buf, off: K.t('x_embedder.proj.bias').off / 4 }, y: { buf: S.src, ld: D } });
    let active = 1, sh = await st.upload('dit.block.00');
    try {
      for (let b = 0; b < c.depth; b++) {
        const first = b % c.attn_res_block === 0;
        this._block(S, sh, b, k, first, active);
        if (b % c.attn_res_block === c.attn_res_block - 1) {
          layout(g, { op: 'cast2d', n: N * D, xf: { buf: S.partial }, yh: { buf: S.src, off: active * N * D * 2 }, a: D, b: D, c: 0, d: D, e: 0 });
          active++;
        }
        g.runner.flush();
        const done = g.device.queue.onSubmittedWorkDone();
        st.release(sh);
        if (b + 1 < c.depth) sh = await st.upload('dit.block.' + String(b + 1).padStart(2, '0'));
        await done;
        if (opts.check) opts.check();
        if (opts.onBlock) opts.onBlock(b);
      }
    } finally { if (sh) st.release(sh); }
    attnres(g, { src: { buf: S.src }, q: { buf: K.buf, off: K.t('attn_res.final_proj.weight').off / 4 }, out: { buf: S.hidden }, N, D, ns: active });
    rowstats(g, { x: { buf: S.hidden }, rows: N, cols: D, mode: 'ln', eps: 1e-6, st: { buf: S.stats } });
    for (const s of S.segs) {   // final layer: (table + t) of each segment's own timestep (T2IFinalLayer.forward_frame_aware)
      const row = s.cond ? this.condRow : k;
      gemm(g, { acc: 'f32', w: K.t('final_layer.linear.weight'), x: { buf: S.hidden, off: s.r0 * D * 4, ld: D, mode: 'lnmod' }, stats: { buf: S.stats, off: s.r0 }, pv: { buf: S.fin, off: row * 2 * D + D, stride: neg(D) },
        M: s.r1 - s.r0, N: 128, K: D, epi: 'resadd', store: true, bv: { buf: K.buf, off: K.t('final_layer.linear.bias').off / 4 }, y: { buf: S.v, off: s.r0 * 512, ld: 128 } });
    }
    const sg = c.sigmas[k], s2 = k + 1 < c.sigmas.length ? c.sigmas[k + 1] : 0;
    if (opts.keepVelocity) opts.keepVelocity.push(new Float32Array(await g.read(S.v)));
    vop(g, { op: 'dmd', n: N * 128, yf: { buf: latent }, af: { buf: S.v }, bf: noise && s2 > 0 ? { buf: noise } : null, s0: sg, s1: s2 > 0 ? f(1 - s2) : 1, s2: s2 > 0 ? s2 : 0 });
    for (const p of pins) g.runner.copy(p.buf, 0, latent, p.frame * S.hw * 512, S.hw * 512);   // LTXFlowEuler: pinned frames never updated
    await g.done();
  }
}

return { SanaDiTCond };
})();
// ---- i2v/i2v_pipeline.js
__M["i2v/i2v_pipeline.js"] = (() => {
// Image-to-video + first/last-frame pipeline (SANA-Video 2.0 5B 4-step + Gemma-2 + LTX-2.3 decoder + the LTX-2.3 STILL encoder):
//   pictures -> still encoder -> pinned latent frames;  text -> Gemma;  4 DMD steps with frame conditioning (SanaDiTCond);  decode;  MP4.
// Same phone-safety contract as pipelines/sana_video.js (SanaVideoPipeline.run, engine 0.3.4), of which run() is an adapted copy:
// latent checkpoint after every step (own slot: 'p0pc0rn:i2v:ckpt' + OPFS engine/sanavideo2-5b/i2v-run, so a text-to-video resume
// is never clobbered), the pinned latents are checkpointed too (resume needs no pictures), everything but the latent is destroyed
// before decode, decode under the GPU budget straight to OPFS, MP4 one frame at a time.
'use strict';
const { SanaVideoPipeline, encodeMp4 } = __M["pipelines/sana_video.js"];
const { LTX2Decoder, ltxFlopsPerPixelFrame } = __M["models/ltx2_vae.js"];
const { GemmaTE } = __M["models/gemma_te.js"];
const { sanaStepFlops } = __M["models/sana_dit.js"];
const { gaussianTokens, sha } = __M["pipelines/klein.js"];
const { SanaDiTCond } = __M["i2v/sana_dit_cond.js"];
const { LTX2StillEncoder } = __M["i2v/still_encoder.js"];
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };
const I2V_CKPT = 'p0pc0rn:i2v:ckpt';
const DIR = 'engine/sanavideo2-5b/i2v-run';
const STILL_FLOPS = (W, H) => 0.56e12 * (W * H) / (832 * 480);

class SanaI2VPipeline extends SanaVideoPipeline {
  /** ctx: {gpu, store (SANA pack), encStore (still-encoder pack), emit, warn, vaeOpts} */
  constructor(ctx) { super(ctx); }
  bind(gpu) {
    this.g = gpu; this.ctx.store.gpu = gpu; if (this.ctx.encStore) this.ctx.encStore.gpu = gpu;
    const apple = /apple/i.test((gpu.info && gpu.info.vendor) || '');
    this.te = new GemmaTE(gpu, this.ctx.store); this.dit = new SanaDiTCond(gpu, this.ctx.store);
    this.vae = new LTX2Decoder(gpu, this.ctx.store, Object.assign({ budgetBytes: apple ? 450e6 : 1.2e9 }, this.ctx.vaeOpts || {}));
    this.enc = this.ctx.encStore ? new LTX2StillEncoder(gpu, this.ctx.encStore) : null;
  }
  static checkpoint() { try { return JSON.parse(LS(I2V_CKPT) || 'null'); } catch (e) { return null; } }

  /** job {prompt, width, height, frames, seed, fps, mode: 'i2v'|'flf', stills: [{rgba, hash}] (first [, last]), check, onProgress,
   *  resume (true = continue the stored checkpoint without pictures), noise0?, noiseT?, condOverride?, pinOverride? ([Float32Array tokens]),
   *  keepVelocity?, stepLatents?, keepLatent?, keepPins?, noEncode?, keepFrames?, noResume?} */
  async run(job) {
    const g = this.g, c = this.ctx.store.m.model, W = job.width, H = job.height, F = job.frames, T = (F - 1) / c.vae.t_compress + 1, h = H / 32, w = W / 32, N = T * h * w, hw = h * w;
    const fps = job.fps || c.video.fps, steps = c.dit.sigmas.length, t0 = performance.now(), up0 = this.ctx.store.stats.uploadMs;
    if (hw % 2) throw Object.assign(new Error('frame conditioning needs an even (H/32)*(W/32)'), { code: 'BAD_SIZE' });
    await this.st.start();
    const pinFrames = job.mode === 'flf' ? [0, T - 1] : [0];
    const timings = { image: 0, text: 0, denoise: 0, steps: [], decode: 0, encode: 0, tileLog: [] }, rate = g.rate, r32 = rate.mm32 || rate.mm, r16 = rate.mm16 || rate.mm;
    const vaeRate = (g.tune && g.tune.vaeAcc === 'f16' ? r16 : r32) * 0.8, plan = this.vae.plan(T, h, w);
    if (!plan) throw Object.assign(new Error('this size does not fit the decoder memory budget'), { code: 'OUT_OF_MEMORY' });
    const encVer = this.ctx.encStore && this.ctx.encStore.m ? this.ctx.encStore.m.pack_version : '';
    const key = await sha(JSON.stringify(['i2v', job.mode, job.prompt, W, H, F, job.seed, this.ctx.store.m.pack_version, encVer, (job.stills || []).map((s) => s.hash)]));
    // ---- resume? (same job, or job.resume = the stored checkpoint, pictures not needed)
    let ck = SanaI2VPipeline.checkpoint(), startStep = 0, latInit = null, pinTok = null;
    if (ck && (ck.key === key || job.resume) && !job.noResume && !job.noise0) {
      latInit = await this._read(`${DIR}/latent.bin`, N * 512);
      const pins = []; for (let i = 0; i < pinFrames.length; i++) pins.push(await this._read(`${DIR}/pin${i}.bin`, hw * 512));
      if (latInit && pins.every(Boolean)) { startStep = Math.min(steps, ck.step); pinTok = pins; } else latInit = null;
    }
    if (job.resume && !latInit) throw Object.assign(new Error('no unfinished clip to resume'), { code: 'NO_CHECKPOINT' });
    const tileFactor = plan.tot / (h * w) * 1.25, nStill = pinFrames.length;
    const est = { image: startStep || pinTok ? 0 : nStill * (STILL_FLOPS(W, H) / r32 + 0.5), text: startStep ? 0 : 1.2e12 / r32 + 1,
      step: sanaStepFlops(N) / r16 + 2.9e9 / 2e9 + 0.3, decode: (ltxFlopsPerPixelFrame * F * H * W * tileFactor) / vaeRate + 2, encode: F * 0.05 };
    let total = est.image + est.text + (steps - startStep) * est.step + est.decode + est.encode, done = 0, corr = 1, phase = 'load', step = startStep, last = 0;
    const emit = (frac, msg, force, extra) => {
      const now = performance.now(); if (!force && now - last < 200) return; last = now;
      const p = Object.assign({ phase, frac: msg === 'done' ? 1 : Math.min(0.999, (done + frac) / total), step, steps, etaSeconds: Math.max(0, Math.round((total - done - frac) * corr)), message: msg || phase,
        elapsed: (now - t0) / 1000, aliveMB: Math.round(g.alive / 1e6), peakMB: Math.round(g.peak / 1e6), pool: g.poolStats ? g.poolStats() : null }, extra || {});   // v026.3
      if (job.onProgress) job.onProgress(p); if (this.ctx.emit) this.ctx.emit(p);
    };
    const finish = (e, s) => { done += e; corr = 0.5 * corr + 0.5 * (s / Math.max(e, 1e-3)); };
    const mark = (ph, extra) => LS('p0pc0rn:i2v:running', JSON.stringify(Object.assign({ phase: ph, w: W, h: H, frames: F, mode: job.mode, t: Date.now() }, extra || {})));
    const saveCk = async (k, lat) => { await this._write(`${DIR}/latent.bin`, new Uint8Array(await g.read(lat)));
      LS(I2V_CKPT, JSON.stringify({ key, step: k, mode: job.mode, prompt: job.prompt, width: W, height: H, frames: F, seed: job.seed, t: Date.now() })); };
    const result = { resumedFromStep: startStep, nvalid: null, textCached: false, mode: job.mode };
    let lat = null; const pinBufs = [];
    try {
      // ---- pictures -> pinned latent frames (before anything else: the encoder's ~0.25 GB is gone before the DiT starts)
      if (!pinTok) {
        phase = 'image'; mark('image'); emit(0, nStill > 1 ? 'Reading the pictures' : 'Reading the picture', true);
        const ts = performance.now(); pinTok = [];
        if (job.pinOverride) pinTok = job.pinOverride.slice(0, nStill);
        else {
          if (!this.enc) throw Object.assign(new Error('the still encoder is not installed'), { code: 'NOT_DOWNLOADED' });
          g.resetPeak();
          const r = await this.enc.encodeMany(job.stills.slice(0, nStill).map((s) => s.rgba), W, H, { check: job.check, onStage: (s, n) => emit(est.image * s / n, nStill > 1 ? 'Reading the pictures' : 'Reading the picture') });
          pinTok = r.tokens; result.imagePeakMB = r.peakMB; timings.imageUpload = +(r.uploadMs / 1000).toFixed(2);
        }
        timings.image = (performance.now() - ts) / 1000; finish(est.image, timings.image);
        LS(I2V_CKPT, null);   // 0.2.0: a fresh job overwrites the pin files, so an older unfinished clip's record must go first (else its resume would mix its latent with these pins)
        for (let i = 0; i < nStill; i++) await this._write(`${DIR}/pin${i}.bin`, new Uint8Array(pinTok[i].buffer, pinTok[i].byteOffset, pinTok[i].byteLength));
        if (job.keepPins) result.pins = pinTok.map((p) => p.slice());
      }
      if (startStep < steps) {
        // ---- text
        phase = 'text'; mark('text'); emit(0, 'Reading the prompt', true);
        let ts = performance.now();
        const cond = job.condOverride ? { cond: g.upload(job.condOverride.data, 'cond'), nvalid: job.condOverride.nvalid, cached: false } :
          await this.getCond(job.prompt, (l) => emit(est.text * (l + 1) / 26, 'Reading the prompt'), job.check);
        timings.text = (performance.now() - ts) / 1000; if (cond.cached) total -= est.text; else finish(est.text, timings.text);
        result.textCached = cond.cached; result.nvalid = cond.nvalid;
        // ---- denoise with the pins
        phase = 'denoise'; mark('denoise', { step: startStep }); emit(0, 'Preparing', true); ts = performance.now();
        const S = await this.dit.prepare(cond, T, h, w, pinFrames.map((f) => ({ frame: f })));
        g.runner.flush(); g.free(cond.cond);
        const pins = pinFrames.map((f, i) => ({ frame: f, buf: g.upload(pinTok[i], 'pin' + i) })); pinBufs.push(...pins.map((p) => p.buf));
        lat = g.upload(latInit || job.noise0 || gaussianTokens(job.seed, T * h, w), 'latent');
        for (const p of pins) g.runner.copy(p.buf, 0, lat, p.frame * hw * 512, hw * 512);   // official: z[:, :, frame] = image latent before sampling
        let nbuf = null;
        try {
          let best = Infinity;
          for (let k = startStep; k < steps; k++) {
            step = k + 1; const tk = performance.now(); emit(0, `Step ${k + 1} of ${steps}`, true); mark('denoise', { step: k + 1 });
            if (k + 1 < steps) nbuf = g.upload(job.noiseT ? job.noiseT[k] : gaussianTokens((job.seed ^ (0x9e3779b1 * (k + 1))) >>> 0, T * h, w), 'noise');
            await this.dit.step(S, k, lat, nbuf, { check: job.check, keepVelocity: job.keepVelocity, onBlock: (i) => emit(est.step * (i + 1) / 33, `Step ${k + 1} of ${steps}`) }, pins);
            if (nbuf) { g.runner.flush(); g.free(nbuf); nbuf = null; }
            const sec = (performance.now() - tk) / 1000; timings.steps.push(+sec.toFixed(2)); finish(est.step, sec);
            if (sec > 1.25 * best && this.ctx.warn && !result.hot) { result.hot = true; this.ctx.warn('HOT', `Step time grew from ${best.toFixed(1)} s to ${sec.toFixed(1)} s: the phone is probably throttling.`); }
            best = Math.min(best, sec);
            if (job.stepLatents) job.stepLatents.push(new Float32Array(await g.read(lat)));
            await saveCk(k + 1, lat);
          }
        } finally { if (nbuf) { g.runner.flush(); g.free(nbuf); } this.dit.free(S); }
        timings.denoise = (performance.now() - ts) / 1000;
      } else {
        lat = g.upload(latInit, 'latent'); emit(0, 'Resuming: decode only', true);
      }
      if (job.keepLatent) result.latent = new Float32Array(await g.read(lat));
      g.runner.flush(); for (const b of pinBufs.splice(0)) g.free(b);
      this.te.freeCache(); this.te.tok = null; g.runner.flush(); await g.done();
      result.aliveBeforeDecodeMB = Math.round(g.alive / 1e6); result.denoisePeakMB = Math.round(g.peak / 1e6); g.resetPeak();
      // ---- decode: tiles -> OPFS frames file
      phase = 'decode'; mark('decode'); emit(0, 'Making the frames', true); let ts = performance.now();
      const fname = `${DIR}/frames.rgba`;
      await this.st.call('truncate', { name: fname, size: F * H * W * 4 });
      const sink = async (rgba, x0, y0, cw, ch, nf, f0) => { const ab = rgba.buffer; await this.st.call('writeRect', { name: fname, buf: ab, F: nf, f0, H, W, x0, y0, cw, ch }, [ab]); };
      const dec = await this.vae.decode(lat, T, h, w, sink, { check: job.check, onStage: (s) => {
        timings.tileLog.push(s);
        emit(est.decode * (s.tile + (s.subs ? s.sub / s.subs : 0)) / s.tiles, `Frames: tile ${s.tile + 1}/${s.tiles}${s.subs ? ` part ${s.sub}/${s.subs}` : ''} (GPU ${s.aliveMB} MB alive, peak ${s.peakMB})`, true, { aliveMB: s.aliveMB, pool: s.pool });
      } });
      await this.st.call('flush', { name: fname });
      timings.decode = (performance.now() - ts) / 1000; timings.tiles = dec.tiles; timings.tileGrid = dec.grid; timings.decodePeakMB = Math.round(g.peak / 1e6); finish(est.decode, timings.decode);
      g.runner.flush(); g.free(lat); lat = null;
      // ---- encode: one frame at a time from OPFS
      phase = 'encode'; mark('encode'); emit(0, 'Saving the video', true); ts = performance.now();
      let fb = new ArrayBuffer(W * H * 4);
      const readFrame = async (f) => { const r = await this.st.call('read', { name: fname, at: f * W * H * 4, len: W * H * 4, buf: fb }, [fb]); fb = r.buf; return new Uint8Array(r.buf, 0, W * H * 4).slice(); };
      if (job.keepFrames) { result.readFrames = async (fn) => { for (let f = 0; f < F; f++) await fn(f, await readFrame(f)); }; result.readFrame = readFrame; }   // v026.3: one frame (the music video's handoff)
      if (!job.noEncode) { const e = await encodeMp4(readFrame, F, H, W, fps, (f) => emit(est.encode * (f + 1) / F, 'Saving the video')); result.mp4 = e.mp4; result.codec = e.codec; }
      timings.encode = (performance.now() - ts) / 1000;
      Object.assign(result, { frames: F, width: W, height: H, fps });
    } finally { g.runner.flush(); if (lat) g.free(lat); for (const b of pinBufs) g.free(b); }
    if (!job.keepFrames) { try { await this.st.call('truncate', { name: `${DIR}/frames.rgba`, size: 0 }); await this.st.call('close', { name: `${DIR}/frames.rgba` }); } catch (e) { /* */ } }
    LS(I2V_CKPT, null);
    timings.upload = +((this.ctx.store.stats.uploadMs - up0) / 1000).toFixed(2);
    result.timings = timings; result.seconds = (performance.now() - t0) / 1000; result.peakMB = Math.max(result.denoisePeakMB || 0, timings.decodePeakMB || 0, result.imagePeakMB || 0);
    phase = 'encode'; emit(total - done, 'done', true);
    LS('p0pc0rn:i2v:running', null);
    return result;
  }
}

return { I2V_CKPT, STILL_FLOPS, SanaI2VPipeline };
})();
// ---- i2v/i2v_engine.js
__M["i2v/i2v_engine.js"] = (() => {
// p0pc0rn image-to-video + first/last-frame engine (probe API; integration proposal in the i2v / FLF spec, section 9).
// Wraps the 0.3.4 engine's SANA-Video model (same pack, same OPFS folder 'engine/sanavideo2-5b/pack', same GPU device / calibration /
// consent / BUSY / cancel conventions) and adds the LTX-2.3 still-encoder pack (its own folder 'engine/ltx23-still-enc/pack', 213 MB).
//   const eng = await createI2VEngine({ videoPackUrl: P0_CONFIG.packs['sanavideo2-5b'], encoderPackUrl: P0_CONFIG.packs['ltx23-still-enc'] });   // config.js
//   await eng.download({ onProgress });                                   // whatever is missing (encoder first, then the video model)
//   const clip = await eng.imageToVideo({ image, prompt, frames: 81, width: 832, height: 480, seed, onProgress, signal });
//   const clip2 = await eng.framesToVideo({ first, last, prompt, ... });   // zero-shot FLF (see the spec's verdict)
// 0.2.0 (p0pc0rn v018): the APP entry createEngine(opts) = the core createEngine, and for the video model (opts.encoderPackUrl given) the
// picture modes are attached to THAT SAME engine object (attachI2V): one GPU device, one job slot (BUSY both ways), one set of events.
// Added to the video engine: imageToVideo, framesToVideo, resumeVideo, encoderStatus, downloadEncoder, deleteEncoder,
// videoCheckpoint(mode) (+ mode field), videoCheckpoints(); status() / download() / textToVideo() are the core's, unchanged.
// No core engine file changed: text-to-video keeps its own pipeline (pipelines/sana_video.js).
'use strict';
const { createEngine: createCoreEngine } = __M["engine.js"];
const { WeightStore } = __M["core/store.js"];
const { sha } = __M["pipelines/klein.js"];
const { SanaI2VPipeline } = __M["i2v/i2v_pipeline.js"];
const I2V_VERSION = '0.2.0';
/** the picture reader (LTX-2.3 still encoder pack): its own OPFS folder, kept apart from the video model's */
const ENCODER = { id: 'ltx23-still-enc', arch: 'ltx2-still-encoder', for: ['sana-video2'], dir: 'engine/ltx23-still-enc/pack', wipe: ['engine/ltx23-still-enc'], running: 'p0pc0rn:i2v:running' };
const I2V_CKPT_KEY = 'p0pc0rn:i2v:ckpt';
const TERMS_VERSION = '2026-10-14.2', CONSENT_KEY = 'p0pc0rn:consent';
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };
const abortErr = () => { const e = new Error('cancelled'); e.name = 'AbortError'; e.code = 'ABORTED'; return e; };
const consented = () => { try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return !!c && c.terms === TERMS_VERSION && !!c.agreedAt; } catch (e) { return false; } };
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; };

/** centre-crop to the target aspect and scale (canvas, high-quality smoothing) -> RGBA Uint8ClampedArray w*h*4 */
async function prepareStill(image, w, h) {
  let bmp;
  try { bmp = image instanceof ImageBitmap ? image : await createImageBitmap(image); } catch (e) { throw err('BAD_IMAGE', 'Could not read that picture.'); }
  if (bmp.width === w && bmp.height === h && typeof OffscreenCanvas !== 'undefined') { /* same size: drawn 1:1 below */ }
  const ar = w / h, sw = Math.min(bmp.width, bmp.height * ar), sh = sw / ar, sx = (bmp.width - sw) / 2, sy = (bmp.height - sh) / 2;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}

async function createI2VEngine(opts = {}) {
  const base = opts.base || await createCoreEngine({ model: 'sanavideo2-5b', packUrl: opts.videoPackUrl || ((globalThis.P0_CONFIG && globalThis.P0_CONFIG.packs['sanavideo2-5b']) || './pack/'), source: opts.source, powerPreference: opts.powerPreference,
    decodeBudgetMB: opts.decodeBudgetMB, acc: opts.acc, vaeChunk: opts.vaeChunk });
  return new I2VEngine(base, opts);
}

class I2VEngine {
  constructor(base, opts) {
    this.base = base; this.opts = opts; this.job = null;
    this.encStore = new WeightStore(null, { base: opts.encoderPackUrl || './pack/', dir: opts.encoderDir || ENCODER.dir, source: opts.source });
    this.encDl = null;   // the picture reader's download in flight (a picture job never waits for it: it refuses with BUSY)
  }
  capabilities() { return this.base.capabilities(); }
  requestPersistentStorage() { return this.base.requestPersistentStorage(); }
  on(n, fn) { this.base.on(n, fn); } off(n, fn) { this.base.off(n, fn); }
  cancel() { if (this.job) this.job.abort(); else this.base.cancel(); }
  tune(o) { return this.base.tune(o); }
  async load() { return this.base.load(); }
  async _openEnc() { if (!this.encStore.m) await this.encStore.open(); return this.encStore; }
  /** {complete, video: {complete, haveBytes, totalBytes, packVersion}, encoder: {...}} */
  async status() {
    const v = await this.base.status(); await this._openEnc(); const s = this.encStore.status();
    const e = { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.encStore.m.pack_version };
    return { complete: v.complete && e.complete, video: v, encoder: e, haveBytes: v.haveBytes + e.haveBytes, totalBytes: v.totalBytes + e.totalBytes };
  }
  /** downloads whatever is missing: the still encoder (213 MB) first, then the video model (5.7 GB, reused when already on this phone) */
  async download({ onProgress, signal, parallel } = {}) {
    if (this.job) throw err('BUSY', 'A video is being made.');
    const st0 = await this.status(), t0 = performance.now();
    const rep = (part, have) => { if (onProgress) onProgress({ part, haveBytes: have, totalBytes: st0.totalBytes, bytesPerSec: 0, etaSeconds: null }); };
    if (!st0.encoder.complete) {
      await this.encStore.download({ signal, parallel, onProgress: (p) => { if (onProgress) onProgress({ part: 'encoder:' + (p.shard || ''), haveBytes: st0.video.haveBytes + p.have, totalBytes: st0.totalBytes,
        bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((st0.totalBytes - st0.video.haveBytes - p.have) / p.bytesPerSec) : null }); } });
    }
    const e = await this.status();
    if (!e.video.complete) {
      await this.base.download({ signal, parallel, onProgress: (p) => { if (onProgress) onProgress(Object.assign({}, p, { part: 'video:' + (p.part || ''), haveBytes: p.haveBytes + e.encoder.haveBytes, totalBytes: st0.totalBytes })); } });
    } else rep('done', e.haveBytes);
    return Object.assign(await this.status(), { seconds: (performance.now() - t0) / 1000 });
  }
  async deleteEncoder() {
    if (this.job || this.base.job) throw err('BUSY', 'A video is being made.');
    if (this.encDl) throw err('BUSY', 'The picture reader is downloading.');
    await this._openEnc(); if (!this.encStore.http) { await this.encStore.st.start(); await this.encStore.remove(); } this.pipe = null;
  }
  /** the picture reader alone: {complete, haveBytes, totalBytes, packVersion} (the core status() reports the video model only) */
  async encoderStatus() { await this._openEnc(); const s = this.encStore.status(); return { complete: s.complete, haveBytes: s.have, totalBytes: s.total, packVersion: this.encStore.m.pack_version }; }
  /** downloads the picture reader only (213 MB, resumable per 16 MiB chunk, verified); onProgress as the core download; signal = pause */
  async downloadEncoder({ onProgress, signal, parallel } = {}) {
    if (this.encDl) throw err('BUSY', 'Already downloading.');
    const run = (async () => {
      await this._openEnc();
      let last = 0;
      try {
        await this.encStore.download({ signal, parallel, onProgress: (p) => {
          const now = performance.now(); if (now - last < 250 && p.have < p.total) return; last = now;
          if (onProgress) onProgress({ haveBytes: p.have, totalBytes: p.total, bytesPerSec: p.bytesPerSec, etaSeconds: p.bytesPerSec > 0 ? Math.round((p.total - p.have) / p.bytesPerSec) : null, part: 'encoder:' + (p.shard || '') });
        } });
      } catch (e) { if (e && e.name === 'AbortError') throw abortErr(); throw e; }
      return this.encoderStatus();
    })();
    this.encDl = run;
    try { return await run; } finally { this.encDl = null; }
  }
  /** the unfinished i2v / FLF clip {mode, prompt, width, height, frames, seed, step} or null; resumeVideo() continues it (no pictures needed) */
  videoCheckpoint() { return SanaI2VPipeline.checkpoint(); }
  forgetCheckpoint() { LS(I2V_CKPT_KEY, null); }

  /** {image, prompt, width=832, height=480, frames=81, seed, fps, onProgress, signal, attested} -> clip (as textToVideo) */
  imageToVideo(o = {}) { return this._run('i2v', o, [o.image]); }
  /** {first, last, prompt, ...} -> clip; the clip starts on `first` and ends on `last` (latent pins, zero-shot; see the spec) */
  framesToVideo(o = {}) { return this._run('flf', o, [o.first, o.last]); }
  resumeVideo(o = {}) {
    const ck = SanaI2VPipeline.checkpoint(); if (!ck) return Promise.reject(err('NO_CHECKPOINT', 'There is no unfinished clip.'));
    return this._run(ck.mode, Object.assign({ prompt: ck.prompt, width: ck.width, height: ck.height, frames: ck.frames, seed: ck.seed }, o, { _resume: true }), []);
  }

  async _run(mode, o, images) {
    if (!consented()) throw err('NO_CONSENT', 'Agree to the p0pc0rn terms (the lesson in the app) before making anything.');
    if (this.job || this.base.job) throw err('BUSY', 'A video is already being made.');
    if (this.base.state === 'downloading') throw err('BUSY', 'The model is downloading.');
    if (this.encDl) throw err('BUSY', 'The picture reader is downloading.');
    const caps = this.base.capabilities(); if (!caps.supported) throw err('UNSUPPORTED', caps.reason || 'This device cannot run the engine.');
    const prompt = String(o.prompt || '').trim();
    if (!prompt) throw err('EMPTY_PROMPT', 'Type what should happen.');
    if (!o._resume) {
      if (images.some((im) => !im)) throw err('BAD_IMAGE', mode === 'flf' ? 'Pick a first and a last picture.' : 'Pick a picture first.');
      if (!o.attested) throw err('NOT_ATTESTED', 'Tick the box about your picture first.');   // the per-upload attestation (rights.js ATTEST) is the UI's; the engine refuses without it
    }
    const w = o.width || 832, h = o.height || 480, F = o.frames || 81, seed = o.seed != null ? o.seed >>> 0 : Math.floor(Math.random() * 2 ** 31);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w % 32 || h % 32 || w < 256 || h < 256 || w * h > 1280 * 736) throw err('BAD_SIZE', 'Width and height must be multiples of 32, at most 1280x736 pixels.');
    if (!Number.isInteger(F) || F < 9 || F > 121 || (F - 1) % 8) throw err('BAD_SIZE', 'frames must be 8k + 1 (9 .. 121).');
    if (mode === 'flf' && F < 17) throw err('BAD_SIZE', 'first/last-frame clips need at least 17 frames (1 s).');
    const ctl = new AbortController();
    if (o.signal) { if (o.signal.aborted) throw abortErr(); o.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
    this.job = ctl; this.base.job = ctl; this.base._setState('working');
    const t0 = performance.now();
    try {
      LS('p0pc0rn:i2v:running', JSON.stringify({ phase: 'load', w, h, frames: F, mode, t: Date.now() }));
      if (o.onProgress) o.onProgress({ phase: 'load', frac: 0, step: 0, steps: 4, etaSeconds: null, message: 'Preparing' });
      await this._openEnc();
      if (!this.encStore.http && !this.encStore.status().complete && !o._pinOverride) throw err('NOT_DOWNLOADED', 'Download the picture reader first.');
      const pipe0 = await this.base._load();                 // GPU device + calibration + the SANA store (shared with textToVideo)
      if (!this.pipe || this.pipe.g !== this.base.gpu) {
        if (!this.encStore.http) await this.encStore.st.start();
        this.pipe = new SanaI2VPipeline(Object.assign({}, pipe0.ctx, { encStore: this.encStore }));
      }
      const check = () => { if (ctl.signal.aborted) throw abortErr(); if (this.base.gpu.lost) throw err('GPU_LOST', 'The GPU was reset.'); };
      const stills = [];
      for (const im of images) { const rgba = await prepareStill(im, w, h); stills.push({ rgba, hash: await sha(rgba) }); }
      check();
      let r;
      try {
        r = await this.pipe.run({ mode, prompt, width: w, height: h, frames: F, seed, fps: o.fps, stills, check, onProgress: o.onProgress, resume: !!o._resume,
          noResume: o.resume === false, noise0: o._noise0, noiseT: o._noiseT, condOverride: o._cond, pinOverride: o._pinOverride, keepVelocity: o._keepVelocity,
          stepLatents: o._stepLatents, keepLatent: o._keepLatent, keepPins: o._keepPins, keepFrames: o._keepFrames, noEncode: o._noEncode });
      } catch (e) {
        if (ctl.signal.aborted || (e && e.name === 'AbortError')) throw abortErr();
        if (this.base.gpu && this.base.gpu.lost) { this.base.gpu = null; this.pipe = null; throw err('GPU_LOST', 'The GPU was reset. Try again.'); }
        if (e && e.code) throw e;
        const m = String(e && e.message || e) + ' ' + String(this.base.gpu && this.base.gpu.lastError || '');
        if (/out of memory|outofmemory|allocation/i.test(m)) throw err('OUT_OF_MEMORY', 'Too big for this device; try a smaller size or fewer frames.');
        throw e;
      }
      const blob = r.mp4 ? new Blob([r.mp4], { type: 'video/mp4' }) : null;
      return { blob, url: blob ? URL.createObjectURL(blob) : null, mode, frames: r.frames, width: r.width, height: r.height, fps: r.fps, seed, prompt, codec: r.codec,
        seconds: (performance.now() - t0) / 1000, timings: Object.assign({ load: (performance.now() - t0) / 1000 - r.seconds }, r.timings), peakMB: r.peakMB, imagePeakMB: r.imagePeakMB,
        denoisePeakMB: r.denoisePeakMB, textCached: r.textCached, resumedFromStep: r.resumedFromStep, aliveBeforeDecodeMB: r.aliveBeforeDecodeMB,
        gpu: this.base.gpu.describe(), calib: this.base.gpu.calib, tune: this.base.gpu.tune, gpuPool: this.base.gpu.poolStats(), _r: r };
    } finally { this.job = null; this.base.job = null; LS('p0pc0rn:i2v:running', null); this.base._setState('idle'); }
  }
}

/** p0pc0rn app entry (0.2.0): createEngine(opts) as the core's; for {model: 'sanavideo2-5b', encoderPackUrl} the picture modes are attached. */
async function createEngine(opts = {}) {
  const base = await createCoreEngine(opts);
  if (opts.model === 'sanavideo2-5b' && opts.encoderPackUrl) attachI2V(base, opts);
  return base;
}

/** Adds the picture modes to an existing core video engine object (in place) and returns it. Same job slot, GPU device and events. */
function attachI2V(base, opts = {}) {
  if (base.i2v) return base;
  const x = new I2VEngine(base, opts), t2vCk = base.videoCheckpoint.bind(base), coreDelete = base.deleteModel.bind(base);
  const ckOf = (mode) => {
    const t = t2vCk(), T = t ? Object.assign({ mode: 't2v' }, t) : null, P = SanaI2VPipeline.checkpoint();
    if (mode === 't2v') return T;
    if (mode === 'picture' || mode === 'i2v' || mode === 'flf') return P;   // one slot for both picture modes; its own `mode` says which
    return [T, P].filter(Boolean).sort((a, b) => (b.t || 0) - (a.t || 0))[0] || null;
  };
  Object.assign(base, {
    i2v: x, I2V_VERSION,
    imageToVideo: (o) => x.imageToVideo(o || {}),
    framesToVideo: (o) => x.framesToVideo(o || {}),
    /** continues an unfinished clip from its checkpoint: {mode?: 't2v' | 'picture' (default: the newer), onProgress, signal}; no pictures needed */
    resumeVideo: (o = {}) => {
      const ck = ckOf(o.mode);
      if (!ck) return Promise.reject(err('NO_CHECKPOINT', 'There is no unfinished clip.'));
      if (ck.mode === 't2v') return base.textToVideo(Object.assign({}, o, { prompt: ck.prompt, width: ck.width, height: ck.height, frames: ck.frames, seed: ck.seed, resume: true }));
      return x.resumeVideo(o);
    },
    encoderStatus: () => x.encoderStatus(),
    downloadEncoder: (o) => x.downloadEncoder(o || {}),
    deleteEncoder: () => x.deleteEncoder(),
    /** the unfinished clip {mode: 't2v' | 'i2v' | 'flf', prompt, width, height, frames, seed, step, t} or null. mode argument: 't2v' = the
     *  text-to-video slot, 'picture' (or 'i2v' / 'flf') = the picture slot, none = the newer of the two. The slots never overwrite each other. */
    videoCheckpoint: (mode) => ckOf(mode),
    videoCheckpoints: () => [ckOf('t2v'), ckOf('picture')].filter(Boolean),
    /** the core deleteModel wipes engine/sanavideo2-5b (both run folders); the picture slot's record goes with it. The reader stays. */
    deleteModel: async () => { await coreDelete(); x.forgetCheckpoint(); x.pipe = null; },
  });
  const run = LS(ENCODER.running);   // a picture job the phone killed (the core reports its own text-to-video runs)
  if (run) {
    LS(ENCODER.running, null); let lastRun = {}; try { lastRun = JSON.parse(run) || {}; } catch (e) { /* */ }
    setTimeout(() => base.emit('warning', { code: 'KILLED_LAST_RUN', message: 'The last clip was interrupted (the phone ran out of memory or got hot). Try again, or pick a smaller size.', lastRun: Object.assign({ picture: true }, lastRun) }), 0);
  }
  return base;
}

return { I2V_VERSION, ENCODER, prepareStill, createI2VEngine, createEngine, attachI2V };
})();
export const { ENGINE_VERSION, MODELS, calibrate, referenceSize } = __M['engine.js'];
export const { createEngine, createI2VEngine, attachI2V, I2V_VERSION, ENCODER, prepareStill } = __M['i2v/i2v_engine.js'];
