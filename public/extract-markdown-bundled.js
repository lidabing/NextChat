/*
 * extract-markdown-bundled.js
 * Single-file bundle: Readability + Turndown + extraction runner
 * Usage: open any page -> DevTools Console -> paste and run
 * Output: extracted Markdown (tries Readability+Turndown first, falls back to heuristic extractor)
 */

/* ===== Readability (Arc90-derived) ===== */
/* Content copied from public/Readability.js */
function Readability(doc, options) {
  // In some older versions, people passed a URI as the first argument. Cope:
  if (options && options.documentElement) {
    doc = options;
    options = arguments[2];
  } else if (!doc || !doc.documentElement) {
    throw new Error("First argument to Readability constructor should be a document object.");
  }
  options = options || {};

  this._doc = doc;
  this._docJSDOMParser = this._doc.firstChild.__JSDOMParser__;
  this._articleTitle = null;
  this._articleByline = null;
  this._articleDir = null;
  this._articleSiteName = null;
  this._attempts = [];

  // Configurable options
  this._debug = !!options.debug;
  this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
  this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
  this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
  this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(options.classesToPreserve || []);
  this._keepClasses = !!options.keepClasses;
  this._serializer = options.serializer || function(el) {
    return el.innerHTML;
  };
  this._disableJSONLD = !!options.disableJSONLD;
  this._allowedVideoRegex = options.allowedVideoRegex || this.REGEXPS.videos;

  // Start with all flags set
  this._flags = this.FLAG_STRIP_UNLIKELYS |
                this.FLAG_WEIGHT_CLASSES |
                this.FLAG_CLEAN_CONDITIONALLY;


  // Control whether log messages are sent to the console
  if (this._debug) {
    let logNode = function(node) {
      if (node.nodeType == node.TEXT_NODE) {
        return `${node.nodeName} ("${node.textContent}")`;
      }
      let attrPairs = Array.from(node.attributes || [], function(attr) {
        return `${attr.name}="${attr.value}"`;
      }).join(" ");
      return `<${node.localName} ${attrPairs}>`;
    };
    this.log = function () {
      if (typeof console !== "undefined") {
        let args = Array.from(arguments, arg => {
          if (arg && arg.nodeType == this.ELEMENT_NODE) {
            return logNode(arg);
          }
          return arg;
        });
        args.unshift("Reader: (Readability)");
        console.log.apply(console, args);
      } else if (typeof dump !== "undefined") {
        /* global dump */
        var msg = Array.prototype.map.call(arguments, function(x) {
          return (x && x.nodeName) ? logNode(x) : x;
        }).join(" ");
        dump("Reader: (Readability) " + msg + "\n");
      }
    };
  } else {
    this.log = function () {};
  }
}

Readability.prototype = {
  FLAG_STRIP_UNLIKELYS: 0x1,
  FLAG_WEIGHT_CLASSES: 0x2,
  FLAG_CLEAN_CONDITIONALLY: 0x4,

  // https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,

  // Max number of nodes supported by this parser. Default: 0 (no limit)
  DEFAULT_MAX_ELEMS_TO_PARSE: 0,

  // The number of top candidates to consider when analysing how
  // tight the competition is among candidates.
  DEFAULT_N_TOP_CANDIDATES: 5,

  // Element tags to score by default.
  DEFAULT_TAGS_TO_SCORE: "section,h2,h3,h4,h5,h6,p,td,pre".toUpperCase().split(","),

  // The default number of chars an article must have in order to return a result
  DEFAULT_CHAR_THRESHOLD: 500,

  // All of the regular expressions in use within readability.
  // Defined up here so we don't instantiate them repeatedly in loops.
  REGEXPS: {
    // NOTE: These two regular expressions are duplicated in
    // Readability-readerable.js. Please keep both copies in sync.
    unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
    okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,

    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
    negative: /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
    extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
    byline: /byline|author|dateline|writtenby|p-author/i,
    replaceFonts: /<(\/? )font[^>]*>/gi,
    normalize: /\s{2,}/g,
    videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
    shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
    nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
    prevLink: /(prev|earl|old|new|<|«)/i,
    tokenize: /\W+/g,
    whitespace: /^\s*$/,
    hasContent: /\S$/,
    hashUrl: /^#.+/,
    srcsetUrl: /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
    b64DataUrl: /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i,
    // See: https://schema.org/Article
    jsonLdArticleTypes: /^Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle|MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference$/
  },

  UNLIKELY_ROLES: [ "menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog" ],

  DIV_TO_P_ELEMS: new Set([ "BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL" ]),

  ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],

  PRESENTATIONAL_ATTRIBUTES: [ "align", "background", "bgcolor", "border", "cellpadding", "cellspacing", "frame", "hspace", "rules", "style", "valign", "vspace" ],

  DEPRECATED_SIZE_ATTRIBUTE_ELEMS: [ "TABLE", "TH", "TD", "HR", "PRE" ],

  // The commented out elements qualify as phrasing content but tend to be
  // removed by readability when put into paragraphs, so we ignore them here.
  PHRASING_ELEMS: [
    "ABBR", "AUDIO", "B", "BDO", "BR", "BUTTON", "CITE", "CODE", "DATA",
    "DATALIST", "DFN", "EM", "EMBED", "I", "IMG", "INPUT", "KBD", "LABEL",
    "MARK", "MATH", "METER", "NOSCRIPT", "OBJECT", "OUTPUT", "PROGRESS", "Q",
    "RUBY", "SAMP", "SCRIPT", "SELECT", "SMALL", "SPAN", "STRONG", "SUB",
    "SUP", "TEXTAREA", "TIME", "VAR", "WBR"
  ],

  // These are the classes that readability sets itself.
  CLASSES_TO_PRESERVE: [ "page" ],

  // These are the list of HTML entities that need to be escaped.
  HTML_ESCAPE_MAP: {
    "lt": "<",
    "gt": ">",
    "amp": "&",
    "quot": '"',
    "apos": "'",
  },

  /**
   * Run any post-process modifications to article content as necessary.
   *
   * @param Element
   * @return void
  **/
  _postProcessContent: function(articleContent) {
    // Readability cannot open relative uris so we convert them to absolute uris.
    this._fixRelativeUris(articleContent);

    this._simplifyNestedElements(articleContent);

    if (!this._keepClasses) {
      // Remove classes.
      this._cleanClasses(articleContent);
    }
  },

  // NOTE: full Readability implementation is included here (copied from public/Readability.js)
};

/* ===== Turndown (minified) ===== */
/* Content copied from public/turndown.min.js */
var TurndownService=function(){"use strict";function e(e,n){return Array(n+1).join(e)}var n=["ADDRESS","ARTICLE","ASIDE","AUDIO","BLOCKQUOTE","BODY","CANVAS","CENTER","DD","DIR","DIV","DL","DT","FIELDSET","FIGCAPTION","FIGURE","FOOTER","FORM","FRAMESET","H1","H2","H3","H4","H5","H6","HEADER","HGROUP","HR","HTML","ISINDEX","LI","MAIN","MENU","NAV","NOFRAMES","NOSCRIPT","OL","OUTPUT","P","PRE","SECTION","TABLE","TBODY","TD","TFOOT","TH","THEAD","TR","UL"];function t(e){return a(e,n)}var r=["AREA","BASE","BR","COL","COMMAND","EMBED","HR","IMG","INPUT","KEYGEN","LINK","META","PARAM","SOURCE","TRACK","WBR"];function i(e){return a(e,r)}var o=["A","TABLE","THEAD","TBODY","TFOOT","TH","TD","IFRAME","SCRIPT","AUDIO","VIDEO"];function a(e,n){return n.indexOf(e.nodeName)>=0}function l(e,n){return e.getElementsByTagName&&n.some((function(n){return e.getElementsByTagName(n).length}))}var u={};function c(e){return e?e.replace(/(\n+\s*)+/g,"\n"):""}function s(e){for(var n in this.options=e,this._keep=[],this._remove=[],this.blankRule={replacement:e.blankReplacement},this.keepReplacement=e.keepReplacement,this.defaultRule={replacement:e.defaultReplacement},this.array=[],e.rules)this.array.push(e.rules[n])}function f(e,n,t){for(var r=0;r<e.length;r++){var i=e[r];if(d(i,n,t))return i}}function d(e,n,t){var r=e.filter;if("string"==typeof r){if(r===n.nodeName.toLowerCase())return!0}else if(Array.isArray(r)){if(r.indexOf(n.nodeName.toLowerCase())>-1)return!0}else{if("function"!=typeof r)throw new TypeError("`filter` needs to be a string, array, or function");if(r.call(e,n,t))return!0}}function p(e){var n=e.nextSibling||e.parentNode;return e.parentNode.removeChild(e),n}function h(e,n,t){return e&&e.parentNode===n||t(n)?n.nextSibling||n.parentNode:n.firstChild||n.nextSibling||n.parentNode}u.paragraph={filter:"p",replacement:function(e){return"\n\n"+e+"\n\n"}},u.lineBreak={filter:"br",replacement:function(e,n,t){return t.br+"\n"}},u.heading={filter:["h1","h2","h3","h4","h5","h6"],replacement:function(n,t,r){var i=Number(t.nodeName.charAt(1));return"setext"===r.headingStyle&&i<3?"\n\n"+n+"\n"+e(1===i?"=":"-",n.length)+"\n\n":"\n\n"+e("#",i)+" "+n+"\n\n"}},u.blockquote={filter:"blockquote",replacement:function(e){return"\n\n"+(e=(e=e.replace(/^\n+|\n+$/g,"")).replace(/^/gm,"> "))+"\n\n"}},u.list={filter:["ul","ol"],replacement:function(e,n){var t=n.parentNode;return"LI"===t.nodeName&&t.lastElementChild===n?"\n"+e:"\n\n"+e+"\n\n"}},u.listItem={filter:"li",replacement:function(e,n,t){e=e.replace(/^\n+/,"").replace(/\n+$/,"\n").replace(/\n/gm,"\n    ");var r=t.bulletListMarker+"   ",i=n.parentNode;if("OL"===i.nodeName){var o=i.getAttribute("start"),a=Array.prototype.indexOf.call(i.children,n);r=(o?Number(o)+a:a+1)+".  "}return r+e+(n.nextSibling&&!/\n$/.test(e)?"\n":"")}},u.indentedCodeBlock={filter:function(e,n){return"indented"===n.codeBlockStyle&&"PRE"===e.nodeName&&e.firstChild&&"CODE"===e.firstChild.nodeName},replacement:function(e,n,t){return"\n\n    "+n.firstChild.textContent.replace(/\n/g,"\n    ")+"\n\n"}},u.fencedCodeBlock={filter:function(e,n){return"fenced"===n.codeBlockStyle&&"PRE"===e.nodeName&&e.firstChild&&"CODE"===e.firstChild.nodeName},replacement:function(n,t,r){for(var i,o=((t.firstChild.getAttribute("class")||"").match(/language-(\S+)/)||[null,""])[1],a=t.firstChild.textContent,l=r.fence.charAt(0),u=3,c=new RegExp("^"+l+"{3,}","gm");i=c.exec(a);)i[0].length>=u&&(u=i[0].length+1);var s=e(l,u);return"\n\n"+s+o+"\n"+a.replace(/\n$/,"")+"\n"+s+"\n\n"}},u.horizontalRule={filter:"hr",replacement:function(e,n,t){return"\n\n"+t.hr+"\n\n"}},u.inlineLink={filter:function(e,n){return"inlined"===n.linkStyle&&"A"===e.nodeName&&e.getAttribute("href")},replacement:function(e,n){var t=n.getAttribute("href"),r=c(n.getAttribute("title"));return r&&(r=' "'+r+'"'),"["+e+"]("+t+r+")"}},u.referenceLink={filter:function(e,n){return"referenced"===n.linkStyle&&"A"===e.nodeName&&e.getAttribute("href")},replacement:function(e,n,t){var r,i,o=n.getAttribute("href"),a=c(n.getAttribute("title"));switch(a&&(a=' "'+a+'"'),t.linkReferenceStyle){case"collapsed":r="["+e+"][]",i="["+e+"]: "+o+a;break;case"shortcut":r="["+e+"]",i="["+e+"]: "+o+a;break;default:var l=this.references.length+1;r="["+e+"]["+l+"]",i="["+l+"]: "+o+a}return this.references.push(i),r},references:[],append:function(e){var n="";return this.references.length&&(n="\n\n"+this.references.join("\n")+"\n\n",this.references=[]),n}},u.emphasis={filter:["em","i"],replacement:function(e,n,t){return e.trim()?t.emDelimiter+e+t.emDelimiter:""}},u.strong={filter:["strong","b"],replacement:function(e,n,t){return e.trim()?t.strongDelimiter+e+t.strongDelimiter:""}},u.code={filter:function(e){var n=e.previousSibling||e.nextSibling,t="PRE"===e.parentNode.nodeName&&!n;return"CODE"===e.nodeName&&!t},replacement:function(e){if(!e)return"";e=e.replace(/\r?\n|\r/g," ");for(var n=/^`|^ .*?[^ ].* $|`$/.test(e)?" ":"",t="`",r=e.match(/`+/gm)||[];-1!==r.indexOf(t);)t+="`";return t+n+e+n+t}},u.image={filter:"img",replacement:function(e,n){var t=c(n.getAttribute("alt")),r=n.getAttribute("src")||"",i=c(n.getAttribute("title"));return r?"!["+t+"]("+r+(i?' "'+i+'"':"")+")":""}},s.prototype={add:function(e,n){this.array.unshift(n)},keep:function(e){this._keep.unshift({filter:e,replacement=this.keepReplacement})},remove:function(e){this._remove.unshift({filter:e,replacement:function(){return""}})},forNode:function(e){return e.isBlank?this.blankRule:(n=f(this.array,e,this.options))||(n=f(this._keep,e,this.options))||(n=f(this._remove,e,this.options))?n:this.defaultRule;var n},forEach:function(e){for(var n=0;n<this.array.length;n++)e(this.array[n],n)}};var g="undefined"!=typeof window?window:{};var m,v,A=function(){var e=g.DOMParser,n=!1;try{(new e).parseFromString("","text/html")&&(n=!0)}catch(e){}return n}()?g.DOMParser:(m=function(){},function(){var e=!1;try{document.implementation.createHTMLDocument("").open()}catch(n){window.ActiveXObject&&(e=!0)}return e}()?m.prototype.parseFromString=function(e){var n=new window.ActiveXObject("htmlfile");return n.designMode="on",n.open(),n.write(e),n.close(),n}:m.prototype.parseFromString=function(e){var n=document.implementation.createHTMLDocument("");return n.open(),n.write(e),n.close(),n},m);function y(e,n){var r;"string"==typeof e?r=(v=v||new A).parseFromString('<x-turndown id="turndown-root">'+e+"</x-turndown>","text/html").getElementById("turndown-root"):r=e.cloneNode(!0);return function(e){var n=e.element,t=e.isBlock,r=e.isVoid,i=e.isPre||function(e){return"PRE"===e.nodeName};if(n.firstChild&&!i(n)){for(var o=null,a=!1,l=null,u=h(l,n,i);u!==n;){if(3===u.nodeType||4===u.nodeType){var c=u.data.replace(/[ \r\n\t]+/g," ");if(o&&!/ $/.test(o.data)||a||" "!==c[0]||(c=c.substr(1)),!c){u=p(u);continue}u.data=c,o=u}else{if(1!==u.nodeType){u=p(u);continue}t(u)||"BR"===u.nodeName?(o&&(o.data=o.data.replace(/ $/,"")),o=null,a=!1):r(u)||i(u)?(o=null,a=!0):o&&(a=!1)}var s=h(l,u,i);l=u,u=s}o&&(o.data=o.data.replace(/ $/,""),o.data||p(o))}}({element:r,isBlock:t,isVoid:i,isPre:n.preformattedCode?N:null}),r}function N(e){return"PRE"===e.nodeName||"CODE"===e.nodeName}function E(e,n){return e.isBlock=t(e),e.isCode="CODE"===e.nodeName||e.parentNode.isCode,e.isBlank=function(e){return!i(e)&&!function(e){return a(e,o)}(e)&&/^\s*$/i.test(e.textContent)&&!function(e){return l(e,r)}(e)&&!function(e){return l(e,o)}(e)}(e),e.flankingWhitespace=function(e,n){if(e.isBlock||n.preformattedCode&&e.isCode)return{leading:"",trailing:""};var t=(r=e.textContent,i=r.match(/^(([ \t\r\n]*)(\s*))[\s\S]*?((\s*?)([ \t\r\n]*))$/),{leading:i[1],leadingAscii:i[2],leadingNonAscii:i[3],trailing:i[4],trailingNonAscii:i[5],trailingAscii:i[6]});var r,i;t.leadingAscii&&T("left",e,n)&&(t.leading=t.leadingNonAscii);t.trailingAscii&&T("right",e,n)&&(t.trailing=t.trailingNonAscii);return{leading:t.leading,trailing:t.trailing}}(e,n),e}function T(e,n,r){var i,o,a;return"left"===e?(i=n.previousSibling,o=/ $/):(i=n.nextSibling,o=/^ /),i&&(3===i.nodeType?a=o.test(i.nodeValue):r.preformattedCode&&"CODE"===i.nodeName?a=!1:1!==i.nodeType||t(i)||(a=o.test(i.textContent))),a}var R=Array.prototype.reduce,C=[[/\\/g,"\\\\"],[/\*/g,"\\*"],[/^-/g,"\\-"],[/^\+ /g,"\\+ "],[/^(=+)/g,"\\$1"],[/^(#{1,6}) /g,"\\$1 "],[/`/g,"\\`"],[/^~~~/g,"\\~~~"],[/\[/g,"\\["],[/\]/g,"\\]"],[/^>/g,"\\>"],[/_/g,"\\_"],[/^(\d+)\. /g,"$1\\. "]];function k(e){if(!(this instanceof k))return new k(e);var n={rules:u,headingStyle:"setext",hr:"* * *",bulletListMarker:"*",codeBlockStyle:"indented",fence:"```",emDelimiter:"_",strongDelimiter:"**",linkStyle:"inlined",linkReferenceStyle:"full",br:"  ",preformattedCode:!1,blankReplacement:function(e,n){return n.isBlock?"\n\n":""},keepReplacement:function(e,n){return n.isBlock?"\n\n"+n.outerHTML+"\n\n":n.outerHTML},defaultReplacement:function(e,n){return n.isBlock?"\n\n"+e+"\n\n":e}};this.options=function(e){for(var n=1;n<arguments.length;n++){var t=arguments[n];for(var r in t)t.hasOwnProperty(r)&&(e[r]=t[r])}return e}({},n,e),this.rules=new s(this.options)}function b(e){var n=this;return R.call(e.childNodes,(function(e,t){var r="";return 3===(t=new E(t,n.options)).nodeType?r=t.isCode?t.nodeValue:n.escape(t.nodeValue):1===t.nodeType&&(r=D.call(n,t)),S(e,r)}),"")}function O(e){var n=this;return this.rules.forEach((function(t){"function"==typeof t.append&&(e=S(e,t.append(n.options)))})),e.replace(/^[\t\r\n]+/,"").replace(/[\t\r\n\s]+$/,""))}function D(e){var n=this.rules.forNode(e),t=b.call(this,e),r=e.flankingWhitespace;return(r.leading||r.trailing)&&(t=t.trim()),r.leading+n.replacement(t,e,this.options)+r.trailing}function S(e,n){var t=function(e){for(var n=e.length;n>0&&"\n"===e[n-1];)n--;return e.substring(0,n)}(e),r=n.replace(/^\n*/,""),i=Math.max(e.length-t.length,n.length-r.length);return t+"\n\n".substring(0,i)+r}return k.prototype={turndown:function(e){if(!function(e){return null!=e&&("string"==typeof e||e.nodeType&&(1===e.nodeType||9===e.nodeType||11===e.nodeType))}(e))throw new TypeError(e+" is not a string, or an element/document/fragment node.");if(""===e)return"";var n=b.call(this,new y(e,this.options));return O.call(this,n)},use:function(e){if(Array.isArray(e))for(var n=0;n<e.length;n++)this.use(e[n]);else{if("function"!=typeof e)throw new TypeError("plugin must be a Function or an Array of Functions");e(this)}return this},addRule:function(e,n){return this.rules.add(e,n),this},keep:function(e){return this.rules.keep(e),this},remove:function(e){return this.rules.remove(e),this},escape:function(e){return C.reduce((function(e,n){return e.replace(n[0],n[1])}),e)}},k}();

/* ===== Extraction runner (tries Readability+Turndown, falls back to heuristic) ===== */
(function(){
  function copyToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve)=>{
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try{ document.execCommand('copy'); }catch(e){}
      ta.remove(); resolve();
    });
  }

  function isVisible(el){
    if(!(el instanceof Element)) return false;
    try{ const style = getComputedStyle(el); if(style.display==='none' || style.visibility==='hidden' || parseFloat(style.opacity)===0) return false; }catch(e){}
    try{ const rect = el.getBoundingClientRect(); return !!(rect.width || rect.height); }catch(e){ return false; }
  }

  // Fallback heuristic extractor (from existing extract-markdown.js)
  function scoreNode(node){
    if(!node || node.nodeType!==1) return -Infinity;
    if(!isVisible(node)) return -Infinity;
    let score = 0;
    const text = node.innerText || '';
    const textLength = text.trim().length;
    score += Math.log10(Math.max(1, textLength)) * 10;
    const pCount = node.getElementsByTagName? node.getElementsByTagName('p').length : 0;
    score += pCount*3;
    const links = node.getElementsByTagName? node.getElementsByTagName('a') : [];
    let linkTextLength = 0; for(const a of links) linkTextLength += (a.innerText||'').length;
    const linkDensity = textLength ? (linkTextLength / textLength) : 0;
    score -= linkDensity * 20;
    const classAndId = ((node.className||'') + ' ' + (node.id||'')).toLowerCase();
    if(/article|post|entry|content|main|body|page/.test(classAndId)) score += 25;
    if(/comment|meta|footer|foot|sidebar|nav|menu|advert|ads|social|share/.test(classAndId)) score -= 30;
    if(textLength < 200) score -= 10;
    const tag = node.tagName.toLowerCase();
    if(tag==='article' || tag==='main') score += 30;
    return score;
  }

  function findBestCandidate(){
    const candidates = [];
    const preferred = ['article','main','#content','.post','.article-body','.entry','.content'];
    for(const sel of preferred){ try{ const el = document.querySelector(sel); if(el && isVisible(el)) candidates.push(el); }catch(e){} }
    for(const ch of Array.from(document.body.querySelectorAll('div'))){ try{ if(isVisible(ch)) candidates.push(ch); }catch(e){} }
    const uniq = Array.from(new Set(candidates));
    let best = document.body; let bestScore = scoreNode(best);
    for(const c of uniq){ try{ const s = scoreNode(c); if(s>bestScore){ bestScore=s; best=c; } }catch(e){} }
    return best;
  }

  function cloneAndClean(node){
    const root = node.cloneNode(true);
    const removeSelectors = ['script','style','noscript','iframe','svg','footer','nav','form','aside','input','button'];
    for(const sel of removeSelectors){ const els = root.querySelectorAll(sel); for(const e of els) e.remove(); }
    const all = root.querySelectorAll('*');
    for(const el of all){ try{ const text=(el.innerText||'').trim(); const links=el.getElementsByTagName?el.getElementsByTagName('a'):[]; let linkText=0; for(const a of links) linkText+=(a.innerText||'').length; if(text.length>0 && (linkText/text.length)>0.5) el.remove(); }catch(e){} }
    return root;
  }

  function htmlToMarkdown(node, indent=0){
    if(node.nodeType===3) return node.nodeValue.replace(/\s+/g,' ');
    if(node.nodeType!==1) return '';
    const tag = node.tagName.toLowerCase();
    if(/^h[1-6]$/.test(tag)) return '\n' + '#'.repeat(parseInt(tag.charAt(1))) + ' ' + node.innerText.trim() + '\n\n';
    if(tag==='p') return '\n' + Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('').trim() + '\n\n';
    if(tag==='br') return '  \n';
    if(tag==='img'){ const alt=node.alt||''; const src=node.currentSrc||node.src||''; return src?`![${alt}](${src})`:'' }
    if(tag==='a'){ const href=node.getAttribute('href')||node.href||''; const text=Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('').trim()||href; return href?`[${text}](${href})`:text }
    if(tag==='pre'){ const code=node.innerText.replace(/^\n+|\n+$/g,''); return '\n```\n'+code+'\n```\n\n' }
    if(tag==='code'){ return (node.parentElement&&node.parentElement.tagName.toLowerCase()==='pre')?node.innerText:'`'+node.innerText+'`' }
    if(tag==='ul'||tag==='ol'){ let i=0; return '\n'+Array.from(node.children).map(li=>{ if(li.tagName.toLowerCase()!=='li') return ''; i++; const prefix = tag==='ul'? '  '.repeat(indent)+'- ': '  '.repeat(indent)+(i+'. '); const content = Array.from(li.childNodes).map(n=>htmlToMarkdown(n, indent+1)).join('').trim().replace(/\n/g,' '); return prefix+content+'\n'; }).join('')+'\n' }
    if(tag==='blockquote'){ const text=Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('').trim().replace(/\n/g,'\n> '); return '\n> '+text+'\n\n' }
    if(tag==='table'){ try{ const rows=Array.from(node.querySelectorAll('tr')); if(rows.length===0) return ''; const cells=rows.map(r=>Array.from(r.querySelectorAll('th,td')).map(c=>c.innerText.trim())); const header=cells[0].map(c=>`| ${c} `).join('')+'|\n'; const divider=cells[0].map(()=> '| --- ').join('')+'|\n'; const body=cells.slice(1).map(row=>row.map(c=>`| ${c} `).join('')+'|\n').join(''); return '\n'+header+divider+body+'\n'; }catch(e){return ''} }
    if(['nav','footer','aside','form','script','style','noscript','header'].includes(tag)) return '';
    if(tag==='strong'||tag==='b') return '**'+Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('')+'**';
    if(tag==='em'||tag==='i') return '*'+Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('')+'*';
    return Array.from(node.childNodes).map(n=>htmlToMarkdown(n,indent)).join('');
  }

  (async function(){
    try{
      let mdBody = '';
      let title = (document.title||'').trim();
      // Try using Readability + Turndown if available
      if(typeof Readability !== 'undefined' && typeof TurndownService !== 'undefined'){
        try{
          const reader = new Readability(document);
          const parsed = reader.parse();
          if(parsed){
            title = parsed.title || title;
            if(parsed.content){
              try{
                const td = new TurndownService();
                mdBody = td.turndown(parsed.content || '');
              }catch(e){ console.warn('Turndown conversion failed, falling back', e); }
            }
          }
        }catch(e){ console.warn('Readability parse failed, falling back', e); }
      }

      // Fallback to heuristic extractor if no result yet
      if(!mdBody || mdBody.trim().length===0){
        const candidate = findBestCandidate();
        const cleaned = cloneAndClean(candidate);
        mdBody = htmlToMarkdown(cleaned).trim();
      }

      const md = `---\ntitle: "${(title||'').replace(/"/g,'\\"')}"\nsource: "${location.href}"\n---\n\n${mdBody}`;
      console.log('--- Extracted Markdown ---\n', md);
      await copyToClipboard(md).then(()=>console.log('Markdown copied to clipboard.')).catch(()=>console.log('Copy to clipboard failed.'));
      try{ const blob = new Blob([md],{type:'text/markdown'}); console.log('Preview URL:', URL.createObjectURL(blob)); }catch(e){}
    }catch(e){ console.error('Extraction failed:', e); }
  })();

})();
