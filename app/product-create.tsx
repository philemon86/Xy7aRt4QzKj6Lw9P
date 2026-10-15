'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { validateNewProduct } from '@/lib/catalog.mjs';

export default function ProductCreate({catalog,request,onCreated,onCancel}:any) {
  const [form,setForm]=useState({code:'',name:'',barcode:'',class:'',kind:'',unitCode:Object.hasOwn(catalog.units || {},'1')?'1':'',ntaxFlag:'1',price:'',cost:'',image:'',priceMode:'default',priceValue:'',start:'',end:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const field=(key:string)=>(event:any)=>setForm({...form,[key]:event.target.value});
  const options=(items:any)=>Object.entries(items || {}).map(([code,title])=><option key={code} value={code}>{code} · {String(title)}</option>);
  return <section className="product-create panel">
    <h2>新增商品</h2>
    <p className="muted">保存後，書房與各教會都能搜尋、掃碼並結帳。原價必填，單品折扣可選填。</p>
    {saved ? <div role="status">
      <p>商品 {saved} 已儲存。</p>
      <Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onCreated(saved);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>重新讀取商品清單</Button>
    </div> : <form onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError('');let code='';
      try {
        validateNewProduct(form,catalog);
        const result=await request('catalog/product',{product:form,revision:catalog.catalogRevision});
        code=result.code;setSaved(code);
        await onCreated(code);
      } catch(e:any) {setError((code?'商品已儲存，重新讀取清單時發生問題：':'')+e.message);}
      finally{setBusy(false);}
    }}>
      <fieldset disabled={busy} className="pricing-form">
        <div className="pricing-grid">
          <label>商品代碼<Input required autoFocus maxLength={100} value={form.code} onChange={field('code')} placeholder="例如 NEW001" autoCapitalize="characters" /></label>
          <label>商品名稱<Input required maxLength={300} value={form.name} onChange={field('name')} /></label>
          <label>條碼（選填）<Input maxLength={100} value={form.barcode} onChange={field('barcode')} placeholder="保留開頭的 0" /></label>
          <label>商品類別<select aria-label="商品類別" required value={form.class} onChange={field('class')}><option value="">請選擇類別</option>{options(catalog.classes)}</select></label>
          <label>品項<select aria-label="品項" value={form.kind} onChange={field('kind')}><option value="">未設定</option>{options(catalog.kinds)}</select></label>
          <label>單位<select aria-label="單位" required value={form.unitCode} onChange={field('unitCode')}><option value="">請選擇單位</option>{options(catalog.units)}</select></label>
          <label>原價（元）<Input required type="number" min={-9999999} max={9999999} step="0.01" value={form.price} onChange={field('price')} /></label>
          <label>成本（元，選填）<Input type="number" min={-9999999} max={9999999} step="0.01" value={form.cost} onChange={field('cost')} /></label>
          <label>稅別<select aria-label="稅別" value={form.ntaxFlag} onChange={field('ntaxFlag')}><option value="1">免稅</option><option value="0">應稅</option></select></label>
          <label>圖片網址（選填）<Input type="url" maxLength={2000} value={form.image} onChange={field('image')} placeholder="https://…" /></label>
        </div>
        <h3>單品售價／折扣</h3>
        <div className="pricing-grid">
          <label>售價方式<select aria-label="售價方式" value={form.priceMode} onChange={field('priceMode')}><option value="default">依原價／官網／類別設定</option><option value="discount">折扣百分比</option><option value="price">固定單價</option></select></label>
          {form.priceMode!=='default'&&<label>{form.priceMode==='discount'?'售價比例（%）':'單品價格（元）'}<Input required type="number" min="0" max={form.priceMode==='discount'?100:9999999} step={form.priceMode==='discount'?'0.1':'0.01'} value={form.priceValue} onChange={field('priceValue')} /></label>}
        </div>
        {form.priceMode!=='default'&&<>
          <p className="muted">百分比 90 表示付原價的 90%，79.5 表示付 79.5%；每件先四捨五入成整數，再乘數量。</p>
          <div className="pricing-grid">
            <label>開始日期（選填）<Input type="date" value={form.start} onChange={field('start')} /></label>
            <label>結束日期（選填）<Input type="date" value={form.end} onChange={field('end')} /></label>
          </div>
          <p className="muted">日期全留白為永久；日期包含起迄當日。</p>
        </>}
        <div className="heading-actions">
          <Button type="submit" className="primary">{busy?'儲存中…':'儲存商品'}</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
        </div>
      </fieldset>
    </form>}
    {error&&<p role="alert" className="product-create-error">{error}</p>}
  </section>;
}
