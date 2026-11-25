"""Build candidate visual features from public pbooks.com.tw product pages.
Only associate an image with a POS SKU if the page has an unambiguous structured SKU.
Ambiguous variant photos remain family-level references. No customer/cost data exported.
"""
import csv, io, json, re, time, argparse
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree as ET
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageOps
from collections import Counter

BASE = "https://www.pbooks.com.tw/"
AGENT = "PhilemonFIND-CatalogIndexer/1.0"
session = requests.Session()
session.headers["User-Agent"] = AGENT
Image.MAX_IMAGE_PIXELS = 25000000
robot = RobotFileParser(urljoin(BASE, "robots.txt"))
def same_site(url):
    return urlparse(url).scheme == "https" and urlparse(url).hostname in {"www.pbooks.com.tw","pbooks.com.tw"}
def get(url, limit=8_000_000, site_only=True):
    if site_only and (not same_site(url) or not robot.can_fetch(AGENT,url)): raise ValueError("Not allowed by site/robots")
    if urlparse(url).scheme!="https": raise ValueError("HTTPS required")
    time.sleep(.7)
    with session.get(url,timeout=(8,20),stream=True,allow_redirects=False) as res:
        res.raise_for_status()
        if res.status_code!=200:raise ValueError("Unexpected HTTP status")
        out=bytearray()
        for chunk in res.iter_content(65536):
            out.extend(chunk)
            if len(out)>limit:raise ValueError("Response too large")
        return bytes(out)

def discover():
    todo=[urljoin(BASE,"sitemap.xml")]
    done=set(); products=set()
    while todo and len(done)<80:
        url=todo.pop(0)
        if url in done:continue
        done.add(url)
        try:
            root=ET.fromstring(get(url))
            for item in root:
                loc=next((x.text for x in item if x.tag.rsplit('}',1)[-1]=='loc'),None)
                if not loc or not same_site(loc):continue
                if item.tag.rsplit('}',1)[-1]=='sitemap':todo.append(loc)
                elif '/products/' in urlparse(loc).path:products.add(loc.split('?')[0])
        except Exception as e: print("Sitemap:",url,str(e))
    return products

def walk(obj):
    if isinstance(obj,dict):
        yield obj
        for val in obj.values():
            yield from walk(val)
    elif isinstance(obj,list):
        for item in obj:yield from walk(item)
def fingerprint(blob):
    with Image.open(io.BytesIO(blob)) as im:
        im=ImageOps.exif_transpose(im).convert("RGB")
        gray=list(im.convert('L').resize((9,8)).getdata())
        bits=''.join('1' if gray[y*9+x+1]>gray[y*9+x] else '0' for y in range(8) for x in range(8))
        hsv=im.resize((64,64)).convert('HSV')
        h,s,v=[0]*8,[0]*4,[0]*4
        for a,b,c in hsv.getdata():h[a//32]+=1;s[b//64]+=1;v[c//64]+=1
        return {"dhash64":f"{int(bits,2):016x}","hsv_hist":[round(x/4096,4) for x in h+s+v],"width":im.width,"height":im.height}

def page(url, known):
    soup=BeautifulSoup(get(url),"html.parser")
    structured=[]
    for el in soup.select('script[type="application/ld+json"]'):
        try:
            structured.extend(x for x in walk(json.loads(el.string or el.get_text())) if "Product" in ([x.get("@type")] if isinstance(x.get("@type"),str) else x.get("@type") or []))
        except (ValueError,TypeError):pass
    # Only use explicit structured SKU, not visual guesses.
    records=[]
    for item in structured:
        code=str(item.get('sku','')).strip().upper()
        if code not in known:continue
        imgs=item.get('image') or []
        if not isinstance(imgs,list):imgs=[imgs]
        urls=[]
        for img in imgs:
            if isinstance(img,dict):img=img.get('url') or img.get('contentUrl')
            if isinstance(img,str):
                img=urljoin(url,img)
                host=urlparse(img).hostname or ''
                # Allow site and known platform image CDN; no arbitrary redirects.
                if urlparse(img).scheme=='https' and (same_site(img) or host=='cyberbiz.co' or host.endswith('.cyberbiz.co') or host=='cyberbiz.com' or host.endswith('.cyberbiz.com') or host=='cyberbizcdn.com' or host.endswith('.cyberbizcdn.com')):
                    urls.append(img)
        records.append((code,urls))
    counts=Counter(c for c,_ in records)
    # Distinct variants may share a stock photo. Do not label such photos as unique SKU imagery.
    occurrences=Counter(i for _,urls in records for i in set(urls))
    result={}
    for code,urls in records:
        result[code]={"source":url,"images":[]}
        if counts[code]!=1:continue
        for img in list(dict.fromkeys(urls))[:3]:
            if occurrences[img]!=1:continue
            try:result[code]["images"].append({"url":img,**fingerprint(get(img,site_only=same_site(img)))})
            except Exception as e:print("Image skipped",code,str(e))
    if len(known)>0 and not records:
        return {}, {"source":url,"reason":"No explicit POS-matching structured SKU"}
    return result,None

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--limit",type=int,default=200)
    p.add_argument("--output",default="catalog-visual-index.json")
    args=p.parse_args()
    try:
        response=session.get(urljoin(BASE,"robots.txt"),timeout=15)
        if response.status_code==404:robot.parse(["User-agent: *","Disallow:"])
        elif response.status_code==200:robot.parse(response.text.splitlines())
        else:raise RuntimeError("Could not verify robots.txt")
    except Exception as e:raise SystemExit(str(e))
    raw=Path("PRODUCT.csv").read_bytes()
    for encoding in ("utf-8-sig","cp950","big5"):
        try: rows=list(csv.DictReader(io.StringIO(raw.decode(encoding))));break
        except UnicodeDecodeError:continue
    known={r['CODE'].strip().upper():r['CLAS'] for r in rows if r.get('CODE') and r.get('CNAME')}
    links=discover()
    def priority(url):
        slug=urlparse(url).path.split('/')[-1].upper()
        if slug in known:return (0 if known[slug].startswith('09') else 1,url)
        if re.match(r'^(PG|PB|CUP|GAW|PEN)',slug):return (0,url)
        return (2,url)
    matched={};unresolved=[]
    for url in sorted(links,key=priority)[:args.limit]:
        try:
            found,issue=page(url,known);matched.update(found)
            if issue:unresolved.append(issue)
        except Exception as e:unresolved.append({"source":url,"reason":str(e)})
    Path(args.output).write_text(json.dumps({"schema":1,"discovered_urls":len(links),"products":matched,"unresolved":unresolved},ensure_ascii=False),encoding='utf-8')
    print("Discovered URLs",len(links),"Matched explicit SKUs",len(matched),"With image fingerprints",sum(bool(v['images']) for v in matched.values()),"Unresolved",len(unresolved))

if __name__=="__main__":main()
