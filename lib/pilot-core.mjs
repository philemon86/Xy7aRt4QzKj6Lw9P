export default (function () {
  'use strict';

  const STKSALE1_HEADER = [
    'ERI','CODE','STAFF','CUST','SDATE','CURR','RATE','PROJNO','GWN','ADDR','TAX','AMT','PLUSSUB','TOTAL','QTY','EDITOR','MEMO','REMARK','ARTICLE','TAXCATE','INVCATE','INVDATE','INVNO','BILDATE','RADVDATE','COST','DPTNO','ACCNO','TYPE','SRCERI','SCRUTINY','PRNIMMED','PRNONCE','ACCDESC','ACCGEN','ACNT','INVAMT','COMPNO','REFNO','PRINTX','BILCUST','BANK','INVNAME','CMPID','PAYCASH','NORCV','CONTACT','TEL','EINVFLAG','APCODE','LASTUPD','POSCODE','POSREMARK1','POSREMARK2','STIME'
  ];

  // 以 PILOT 已驗證 STKSALE2.csv 的正式欄位順序為唯一 schema。
  const STKSALE2_HEADER = [
    'ERI','MASTERI','SRCERI','STAFF','CUST','GWN','PROD','SDATE','TYPE','CODE','SERIAL','SPEC','QTY','UNIT','PRICE','AMT','REALQTY','SUBQTY','REMARK','PRODDESC','QTYSTR','CURR','RATE','STDPRC','DISCOUNT','PROJNO','INVNO','INVQTY','SAMPLE','INVRETURN','VPNO','VLIDDATE','REFNO','INVPRC','INVAMT','INVAMT1','GIFT','MFLAG','SUBAMT','APCODE','LASTUPD','POSREMARK1','POSREMARK2'
  ];

  const VCHRPLUS_HEADER = ['ERI','SRCERI','SERIAL','CODE','SUBJNO','OP','AMT','REMARK','APCODE','LASTUPD'];

  const BOOK_FAIR_CODE = '0002';
  const PERSONAL_CODE = '305';
  const DEFAULT_DONATION_CODE = '2995';

  const TAX_PROFILES = {
    taxable: { key: 'taxable', taxCate: 0 },
    exempt: { key: 'exempt', taxCate: 1 }
  };

  // 保留雲 POS 既有會計科目 mapping。
  const PAYMENT_MAPPING = {
    '信用卡': { code: '5', subject: '1144.355' },
    'LINE PAY': { code: '51', subject: '1144.358' },
    '文化幣': { code: '61', subject: '1144.61' }
  };

  const roundTo = (value, digits = 2) => {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  };

  const rowFromObject = (header, value) => header.map(column => (
    value[column] !== undefined ? value[column] : ''
  ));

  const sameHeader = (actual, expected) => (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );

  const duplicateCount = (values) => {
    const counts = new Map();
    values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  };

  const paymentMethodName = (rawMethod) => {
    const original = String(rawMethod || '').trim();
    const method = original.toUpperCase();
    if (method.includes('文化幣')) return '文化幣';
    if (method.includes('LINE')) return 'LINE PAY';
    if (method.includes('信用卡')) return '信用卡';
    if (method.includes('現金')) return '現金';
    return original;
  };

  function getPaymentRecords(client) {
    const total = roundTo(client?.amount);
    // 零元訂單沒有實際收款，不應產生現金或電子支付紀錄。
    if (total === 0) return [];

    if (Array.isArray(client?.paymentRecords) && client.paymentRecords.length) {
      return client.paymentRecords.map(record => ({
        method: paymentMethodName(record.method || record.paymentMethod || record.type),
        amount: roundTo(record.amount)
      }));
    }

    const paymentMethod = String(client?.paymentMethod || '現金').trim();
    const parts = paymentMethod.split(/\s*\+\s*/).filter(Boolean);

    if (parts.length === 1 && !/\([-+]?\d+(?:\.\d+)?\)/.test(parts[0])) {
      return [{ method: paymentMethodName(parts[0]), amount: total }];
    }

    return parts.map(part => {
      const amountMatch = part.match(/\(([-+]?\d+(?:\.\d+)?)\)/);
      return {
        method: paymentMethodName(part),
        amount: amountMatch ? roundTo(amountMatch[1]) : NaN
      };
    });
  }

  const formatDocumentPrefix = (date) => {
    const rocYear = date.getFullYear() - 1911;
    const month = date.getMonth() + 1; // 月份不補 0：8 月 => 8
    const day = String(date.getDate()).padStart(2, '0');
    return `${rocYear}BF${month}${day}`;
  };

  const normalizeCustomerNumber = (value, fallback) => {
    const raw = String(value ?? '').trim();
    if (raw === '') return fallback;
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  };

  function buildPilotExport(options) {
    const {
      clients = {},
      products = {},
      customerMap = {},
      unitMap = {},
      generateERI,
      now = new Date(),
      whCode = '0000',
      staffCode = '02'
    } = options || {};

    if (typeof generateERI !== 'function') throw new Error('缺少 PILOT ERI 產生器');

    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const date = `${yyyy}/${MM}/${DD}`;
    const ts = String(yyyy).slice(-2) + MM + DD + hh + mi + ss;
    const documentPrefix = formatDocumentPrefix(now);

    const usedEriSet = new Set();
    const eriPatterns = {
      master: /^0H5.{13}$/,
      detail: /^0H8.{13}$/,
      pay: /^01E.{13}$/
    };

    const allocateEri = (type, preferred = '') => {
      const candidate = String(preferred || '').trim();
      if (eriPatterns[type]?.test(candidate) && !usedEriSet.has(candidate)) {
        usedEriSet.add(candidate);
        return candidate;
      }
      for (let attempt = 0; attempt < 1000; attempt += 1) {
        const generated = String(generateERI(type) || '').trim();
        if (eriPatterns[type]?.test(generated) && !usedEriSet.has(generated)) {
          usedEriSet.add(generated);
          return generated;
        }
      }
      throw new Error(`無法產生唯一的 ${type} ERI`);
    };

    const audit = {
      stkSale1Count: 0,
      stkSale2Count: 0,
      voucherCount: 0,
      first10Codes: [],
      headerErrors: 0,
      columnCountErrors: 0,
      duplicateCodeCount: 0,
      duplicateEriCount: 0,
      orphanMasteriCount: 0,
      masterDetailKeyErrorCount: 0,
      serialSequenceErrorCount: 0,
      orphanSrceriCount: 0,
      taxCateErrorCount: 0,
      masterAmountErrorCount: 0,
      detailMasterAmountErrorCount: 0,
      customerResolverErrorCount: 0,
      productResolverErrorCount: 0,
      transactionIdErrorCount: 0,
      paymentAssociationErrorCount: 0,
      paymentAmountErrorCount: 0,
      skippedZeroAmountCount: 0,
      plusSubErrorCount: 0,
      voucherSerialSequenceErrorCount: 0,
      invoiceFieldErrorCount: 0,
      costErrorCount: 0,
      taxableGross: 0,
      exemptGross: 0,
      exportedGross: 0,
      expectedGross: 0,
      unresolvedProductCodes: []
    };

    const unresolvedProductCodes = new Set();
    const validClientEntries = Object.entries(clients).filter(([, client]) => client && client.isValid);
    const seenTransactionIds = new Set();
    const preparedClients = [];
    const customerResolverTransactionIds = [];

    validClientEntries.forEach(([storageKey, client]) => {
      const transactionId = String(client.transactionId || client.id || storageKey || '').trim();
      if (!transactionId || seenTransactionIds.has(transactionId)) audit.transactionIdErrorCount += 1;
      if (transactionId) seenTransactionIds.add(transactionId);

      const invoiceInfo = client.invoiceInfo || {};
      const taxId = String(invoiceInfo.taxId || '').trim();
      const carrier = String(invoiceInfo.carrier || '').trim();
      const donationCode = String(invoiceInfo.donationCode || '').trim();

      let invoiceType = 'general';
      let customerCode = BOOK_FAIR_CODE;
      let customerResolverFailed = false;

      if (taxId) {
        invoiceType = 'church';
        customerCode = String(client.bookFairCustomerCode || '').trim();
        if (!customerCode || customerCode === BOOK_FAIR_CODE || customerCode === PERSONAL_CODE) {
          customerResolverFailed = true;
        }
      } else if (carrier) {
        invoiceType = 'carrier';
        customerCode = PERSONAL_CODE;
      } else if (donationCode && donationCode !== DEFAULT_DONATION_CODE) {
        // 2995 併一般書展；其他愛心碼保留為自己的交易組，不被彙總吃掉。
        invoiceType = 'donation';
        customerCode = BOOK_FAIR_CODE;
      }

      const customer = customerMap[customerCode];
      if (!customerCode || !customer) customerResolverFailed = true;
      if (customerResolverFailed) {
        audit.customerResolverErrorCount += 1;
        customerResolverTransactionIds.push(transactionId || storageKey);
      }

      const entries = (client.items || []).map(item => {
        const itemCode = String(item?.code || '').trim();
        let currentProduct = null;

        // 有 CODE 時只能用 CODE 命中。不能因重複 BARCODE 偷換成另一個正式商品。
        if (itemCode) currentProduct = products[itemCode] || null;
        else if (item?.barcode) currentProduct = products[item.barcode] || null;

        if (!currentProduct || !currentProduct.code) {
          audit.productResolverErrorCount += 1;
          unresolvedProductCodes.add(itemCode || String(item?.barcode || '').trim() || '(空白)');
        }

        const ntaxFlag = String(currentProduct?.ntaxFlag ?? '').trim();
        if (ntaxFlag !== '0' && ntaxFlag !== '1') audit.taxCateErrorCount += 1;
        const taxProfile = ntaxFlag === '1' ? TAX_PROFILES.exempt : TAX_PROFILES.taxable;
        const discountRate = item.discount !== undefined ? Number(item.discount) : 100;
        const soldPrice = Number(item.price || 0) * (discountRate / 100);
        const quantity = Number(item.quantity || 0);

        return {
          client,
          transactionId,
          item,
          currentProduct,
          soldPrice,
          grossAmount: Math.round(soldPrice * quantity),
          costAmount: roundTo(Number(currentProduct?.cost || 0) * quantity),
          taxProfile
        };
      });

      const allocatedAmount = entries.reduce((sum, entry) => sum + entry.grossAmount, 0);

      const savedAmount = Number(client.amount);
      // 舊版在重新開啟含購物車的頁面時沒有重算總額，可能把有商品的訂單存成 0 元。
      // 明細有非零金額（包含負值退款／折抵）時可恢復；真正的零元商品仍保留為 0 元。
      const shouldRecoverZeroAmount = Number.isFinite(savedAmount)
        && roundTo(savedAmount) === 0
        && roundTo(allocatedAmount) !== 0;
      const targetAmount = Number.isFinite(savedAmount) && !shouldRecoverZeroAmount
        ? Math.round(savedAmount)
        : allocatedAmount;

      // 結帳儲存總額為權威；只把極小的整筆尾差留給最後一筆，避免改掉成交總額。
      if (entries.length && allocatedAmount !== targetAmount) {
        entries[entries.length - 1].grossAmount += targetAmount - allocatedAmount;
      }

      let paymentRecords = getPaymentRecords(client);
      const savedPaymentTotal = roundTo(paymentRecords.reduce((sum, record) => (
        sum + (Number.isFinite(record.amount) ? Number(record.amount) : 0)
      ), 0));
      if (shouldRecoverZeroAmount && savedPaymentTotal === 0) {
        paymentRecords = getPaymentRecords({
          paymentMethod: client.paymentMethod,
          amount: targetAmount
        });
      }
      if (paymentRecords.some(record => !Number.isFinite(record.amount))) {
        audit.paymentAmountErrorCount += 1;
      } else {
        const paymentTotal = roundTo(paymentRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0));
        if (paymentTotal !== roundTo(targetAmount)) audit.paymentAmountErrorCount += 1;
      }

      // 只略過沒有明細的空白舊紀錄。有商品的零元訂單仍須輸出 master/detail，
      // 才能讓 Pilot 正確記錄銷售數量與庫存異動。
      if (entries.length === 0 && roundTo(targetAmount) === 0 && roundTo(allocatedAmount) === 0) {
        audit.skippedZeroAmountCount += 1;
        return;
      }

      audit.expectedGross += targetAmount;
      preparedClients.push({
        ...client,
        transactionId,
        invoiceInfo,
        invoiceType,
        accountingCustomer: customer || { code: customerCode, name: '', invoiceName: '', invcate: '', einvflag: '' },
        exportEntries: entries,
        exportAmount: targetAmount,
        paymentRecords
      });
    });

    audit.unresolvedProductCodes = [...unresolvedProductCodes];

    const generalClients = preparedClients.filter(client => client.invoiceType === 'general');
    const separateClients = preparedClients.filter(client => client.invoiceType !== 'general');
    const groups = [];

    const appendTaxGroups = (sourceClients, customer, invoiceType) => {
      [TAX_PROFILES.taxable, TAX_PROFILES.exempt].forEach(taxProfile => {
        const clientsInGroup = sourceClients.filter(client => (
          client.exportEntries.some(entry => entry.taxProfile.key === taxProfile.key)
        ));
        const entries = clientsInGroup.flatMap(client => (
          client.exportEntries.filter(entry => entry.taxProfile.key === taxProfile.key)
        ));
        if (!entries.length) return;

        groups.push({
          customer,
          clients: clientsInGroup,
          entries,
          invoiceType,
          taxProfile,
          masterERI: ''
        });
      });
    };

    if (generalClients.length) {
      appendTaxGroups(
        generalClients,
        customerMap[BOOK_FAIR_CODE] || { code: BOOK_FAIR_CODE, name: '書展', invoiceName: '書展', invcate: '3', einvflag: '0' },
        'general'
      );
    }

    // 保留原 transaction 順序；同交易固定先應稅再免稅。
    separateClients.forEach(client => appendTaxGroups([client], client.accountingCustomer, client.invoiceType));

    groups.forEach((group, index) => {
      group.documentCode = `${documentPrefix}-${String(index + 1).padStart(3, '0')}`;
    });

    const transactionToPrimaryMasterEri = new Map();
    const transactionToMasterSlices = new Map();

    const masterObjects = [];
    const detailObjects = [];

    groups.forEach(group => {
      // 每張主單先取 master ERI，再立即產生該主單所有 detail ERI。
      group.masterERI = allocateEri('master');

      group.clients.forEach(client => {
        if (!transactionToPrimaryMasterEri.has(client.transactionId)) {
          transactionToPrimaryMasterEri.set(client.transactionId, group.masterERI);
        }

        // 記住「這個交易」在「這張拆稅 master」中實際占多少銷售額。
        // 後面付款加減項會按這些 slice 分配，避免把整筆非現金付款全塞進第一張 master。
        const sliceGross = group.entries
          .filter(entry => entry.transactionId === client.transactionId)
          .reduce((sum, entry) => sum + Number(entry.grossAmount || 0), 0);

        // 零元交易也要保留 master 關聯；雖然不會產生付款加減項，仍是有效銷售。
        if (!transactionToMasterSlices.has(client.transactionId)) {
          transactionToMasterSlices.set(client.transactionId, []);
        }
        transactionToMasterSlices.get(client.transactionId).push({
          masterERI: group.masterERI,
          grossAmount: roundTo(sliceGross),
          taxProfile: group.taxProfile.key
        });
      });

      const grossTotal = group.entries.reduce((sum, entry) => sum + entry.grossAmount, 0);
      const totalQty = group.entries.reduce((sum, entry) => sum + Number(entry.item.quantity || 0), 0);
      const costTotal = roundTo(group.entries.reduce((sum, entry) => sum + entry.costAmount, 0));
      const isTaxable = group.taxProfile.key === TAX_PROFILES.taxable.key;
      const netAmount = isTaxable ? Math.round(grossTotal / 1.05) : grossTotal;
      const taxAmount = grossTotal - netAmount;

      const groupDetails = group.entries.map((entry, serial) => {
        const { item, currentProduct, soldPrice, grossAmount } = entry;
        const unitCode = item.unitCode || currentProduct?.unitCode || '';
        // UNIT / unitMap 沿用網站原有邏輯，不在此次匯出修正中另行推導。
        const exportUnit = unitMap[unitCode] || item.unit || unitCode || '個';

        return {
          ERI: allocateEri('detail'),
          MASTERI: group.masterERI,
          SRCERI: '',
          STAFF: '',
          CUST: group.customer.code,
          GWN: whCode,
          PROD: currentProduct?.code || String(item.code || ''),
          SDATE: date,
          TYPE: 0,
          CODE: group.documentCode,
          SERIAL: serial,
          SPEC: '',
          QTY: item.quantity,
          UNIT: exportUnit,
          PRICE: isTaxable ? roundTo(soldPrice / 1.05) : roundTo(soldPrice),
          AMT: isTaxable ? roundTo(grossAmount / 1.05) : grossAmount,
          REALQTY: item.quantity,
          SUBQTY: 0,
          REMARK: '',
          PRODDESC: '',
          QTYSTR: exportUnit,
          CURR: 'NTD',
          RATE: 1,
          STDPRC: isTaxable ? roundTo(soldPrice / 1.05) : roundTo(soldPrice),
          DISCOUNT: 100,
          PROJNO: '',
          INVNO: '',
          INVQTY: item.quantity,
          SAMPLE: 0,
          INVRETURN: 0,
          VPNO: '',
          VLIDDATE: date,
          REFNO: '',
          INVPRC: roundTo(soldPrice),
          INVAMT: grossAmount,
          INVAMT1: 0,
          GIFT: 0,
          MFLAG: 0,
          SUBAMT: 0,
          APCODE: '',
          LASTUPD: ts,
          POSREMARK1: '',
          POSREMARK2: '',
          _taxProfile: entry.taxProfile.key,
          _transactionId: entry.transactionId
        };
      });

      // 明細含稅轉未稅逐筆會有 rounding 尾差；最後一筆吸收，確保 SUM(detail AMT)=master AMT。
      const detailNetTotal = roundTo(groupDetails.reduce((sum, detail) => sum + Number(detail.AMT || 0), 0));
      if (groupDetails.length && detailNetTotal !== roundTo(netAmount)) {
        const lastDetail = groupDetails[groupDetails.length - 1];
        lastDetail.AMT = roundTo(Number(lastDetail.AMT || 0) + netAmount - detailNetTotal);
      }
      detailObjects.push(...groupDetails);

      const singleClient = group.clients.length === 1 ? group.clients[0] : null;
      const invoiceInfo = singleClient?.invoiceInfo || {};

      // PILOT「附註」要保存實際輸入內容，不再使用 POS_Import / 雲端載具等泛稱。
      // 有正式 PILOT 欄位的資料（例如統編）仍走正式欄位，不重複塞進附註。
      const remarkParts = [];
      const addRemark = (value) => {
        const normalized = String(value || '').trim();
        if (normalized && !remarkParts.includes(normalized)) remarkParts.push(normalized);
      };

      if (group.invoiceType === 'carrier' && invoiceInfo.carrier) {
        addRemark(`載具：${String(invoiceInfo.carrier).trim()}`);
      }
      if (group.invoiceType === 'donation' && invoiceInfo.donationCode) {
        addRemark(`捐贈：${String(invoiceInfo.donationCode).trim()}`);
      }

      // 2995 會併入一般書展；若該彙整組內確實有 2995，附註仍保留這項已記錄資料。
      if (group.invoiceType === 'general') {
        const hasDefaultDonation = group.clients.some(client => (
          String(client?.invoiceInfo?.donationCode || '').trim() === DEFAULT_DONATION_CODE
        ));
        if (hasDefaultDonation) addRemark(`捐贈：${DEFAULT_DONATION_CODE}`);
      }

      // 手動備註也要進 PILOT 附註；彙整單若有多筆備註則去重後合併。
      group.clients.forEach(client => addRemark(client?.note));

      const masterRemark = remarkParts.join('；');
      const customer = group.customer || {};
      const invoiceName = String(customer.invoiceName || customer.name || '').trim();

      const master = {
        ERI: group.masterERI,
        CODE: group.documentCode,
        STAFF: staffCode,
        CUST: customer.code,
        SDATE: date,
        CURR: 'NTD',
        RATE: 1,
        PROJNO: '',
        GWN: whCode,
        ADDR: '',
        TAX: taxAmount,
        AMT: netAmount,
        PLUSSUB: 0,
        TOTAL: grossTotal,
        QTY: totalQty,
        EDITOR: 'POS',
        MEMO: '',
        REMARK: masterRemark,
        ARTICLE: '',
        TAXCATE: group.taxProfile.taxCate,
        INVCATE: normalizeCustomerNumber(customer.invcate, group.invoiceType === 'general' || group.invoiceType === 'donation' ? 3 : 2),
        INVDATE: date,
        INVNO: '',
        BILDATE: date,
        RADVDATE: date,
        COST: costTotal,
        DPTNO: '0000',
        ACCNO: '',
        TYPE: 0,
        SRCERI: '',
        SCRUTINY: '',
        PRNIMMED: 0,
        PRNONCE: 0,
        ACCDESC: '',
        ACCGEN: 0,
        ACNT: '',
        INVAMT: 0,
        COMPNO: '0000',
        REFNO: '',
        PRINTX: 0,
        BILCUST: customer.code,
        BANK: '',
        INVNAME: invoiceName,
        CMPID: group.invoiceType === 'church' ? String(invoiceInfo.taxId || '').trim() : '',
        PAYCASH: 1,
        NORCV: 0,
        CONTACT: '',
        TEL: '',
        EINVFLAG: normalizeCustomerNumber(customer.einvflag, group.invoiceType === 'general' || group.invoiceType === 'donation' ? 0 : 1),
        APCODE: '',
        LASTUPD: ts,
        POSCODE: '',
        POSREMARK1: '',
        POSREMARK2: '',
        STIME: '',
        _invoiceType: group.invoiceType,
        _transactionIds: group.clients.map(client => client.transactionId),
        _expectedCost: costTotal
      };

      masterObjects.push(master);
      audit.exportedGross += grossTotal;
      audit[isTaxable ? 'taxableGross' : 'exemptGross'] += grossTotal;
    });

    const voucherObjects = [];
    const voucherSerialByMaster = new Map();

    const appendVoucher = (client, record, mapping, slice, allocation) => {
      if (roundTo(allocation) === 0) return;
      const voucherSerial = voucherSerialByMaster.get(slice.masterERI) || 0;

      voucherObjects.push({
        ERI: allocateEri('pay'),
        SRCERI: slice.masterERI,
        SERIAL: voucherSerial,
        CODE: mapping.code,
        SUBJNO: mapping.subject,
        OP: 0,
        AMT: -allocation,
        REMARK: '',
        APCODE: '',
        LASTUPD: ts,
        _transactionId: client.transactionId,
        _expectedSrceri: slice.masterERI,
        _expectedAmount: -allocation,
        _paymentMethod: record.method
      });

      voucherSerialByMaster.set(slice.masterERI, voucherSerial + 1);
    };

    preparedClients.forEach(client => {
      const slices = (transactionToMasterSlices.get(client.transactionId) || [])
        .map(slice => ({ ...slice, remaining: Number(slice.grossAmount || 0) }));

      const mappedRecords = client.paymentRecords.filter(record => (
        PAYMENT_MAPPING[record.method] && Number.isFinite(record.amount)
      ));

      if (!slices.length) {
        if (mappedRecords.some(record => roundTo(record.amount) !== 0)) {
          audit.paymentAssociationErrorCount += 1;
        }
        return;
      }

      // 全額單一非現金付款可逐張 master 直接沖銷。這也涵蓋退換貨中
      // 同時存在正、負明細的情況：負銷售產生正加減項，正銷售則反向扣回。
      const sliceTotal = roundTo(slices.reduce((sum, slice) => sum + Number(slice.grossAmount || 0), 0));
      if (mappedRecords.length === 1 && roundTo(mappedRecords[0].amount) === sliceTotal) {
        const record = mappedRecords[0];
        const mapping = PAYMENT_MAPPING[record.method];
        slices.forEach(slice => appendVoucher(
          client,
          record,
          mapping,
          slice,
          roundTo(slice.grossAmount)
        ));
        return;
      }

      client.paymentRecords.forEach(record => {
        const mapping = PAYMENT_MAPPING[record.method];

        // 現金不產 VCHRPLUS；未知付款也不自行發明科目。
        if (!mapping) return;
        if (!Number.isFinite(record.amount)) return;

        let remainingPayment = Math.round(Number(record.amount || 0));

        // 將這筆非現金付款依正負方向分配到各拆稅 master。
        // 正數為收款、負數為退款；VCHRPLUS 會寫入相反符號。
        for (const slice of slices) {
          if (remainingPayment === 0) break;
          if (slice.remaining === 0) continue;
          if (Math.sign(slice.remaining) !== Math.sign(remainingPayment)) continue;

          const direction = Math.sign(remainingPayment);
          const allocation = direction * Math.min(
            Math.abs(remainingPayment),
            Math.abs(Math.round(Number(slice.remaining || 0)))
          );
          if (allocation === 0) continue;

          appendVoucher(client, record, mapping, slice, allocation);
          slice.remaining = roundTo(slice.remaining - allocation);
          remainingPayment -= allocation;
        }

        // 非現金付款若仍有剩餘，代表付款總額大於此交易銷售額或 master 分配有問題。
        if (remainingPayment !== 0) {
          audit.paymentAssociationErrorCount += 1;
        }
      });
    });

    // PILOT 實際匯出資料的規則：
    //   TOTAL = AMT + TAX + PLUSSUB
    //   PLUSSUB = 該主單所有 VCHRPLUS.AMT 合計
    //
    // 例如全額信用卡 450：
    //   AMT 429 + TAX 21 + PLUSSUB(-450) = TOTAL 0
    //
    // 現金不寫 VCHRPLUS，因此現金部分會留在 TOTAL。
    const voucherSumByMaster = new Map();
    voucherObjects.forEach(voucher => {
      const current = Number(voucherSumByMaster.get(voucher.SRCERI) || 0);
      voucherSumByMaster.set(
        voucher.SRCERI,
        roundTo(current + Number(voucher.AMT || 0))
      );
    });

    masterObjects.forEach(master => {
      const plusSub = roundTo(voucherSumByMaster.get(master.ERI) || 0);
      master.PLUSSUB = plusSub;
      master.TOTAL = roundTo(
        Number(master.AMT || 0)
        + Number(master.TAX || 0)
        + plusSub
      );
      master._expectedPlusSub = plusSub;
      master._expectedTotal = master.TOTAL;
    });

    const s1Rows = [STKSALE1_HEADER, ...masterObjects.map(master => rowFromObject(STKSALE1_HEADER, master))];
    const s2Rows = [STKSALE2_HEADER, ...detailObjects.map(detail => rowFromObject(STKSALE2_HEADER, detail))];
    const v1Rows = [VCHRPLUS_HEADER, ...voucherObjects.map(voucher => rowFromObject(VCHRPLUS_HEADER, voucher))];

    const masterByEri = new Map(masterObjects.map(master => [master.ERI, master]));
    const masterEris = new Set(masterByEri.keys());

    audit.stkSale1Count = masterObjects.length;
    audit.stkSale2Count = detailObjects.length;
    audit.voucherCount = voucherObjects.length;
    audit.first10Codes = masterObjects.slice(0, 10).map(master => master.CODE);

    audit.headerErrors = [
      sameHeader(s1Rows[0], STKSALE1_HEADER),
      sameHeader(s2Rows[0], STKSALE2_HEADER),
      sameHeader(v1Rows[0], VCHRPLUS_HEADER)
    ].filter(ok => !ok).length;

    audit.columnCountErrors = [
      ...s1Rows.slice(1).map(row => row.length === STKSALE1_HEADER.length),
      ...s2Rows.slice(1).map(row => row.length === STKSALE2_HEADER.length),
      ...v1Rows.slice(1).map(row => row.length === VCHRPLUS_HEADER.length)
    ].filter(ok => !ok).length;

    audit.duplicateCodeCount = duplicateCount(masterObjects.map(master => master.CODE));
    audit.duplicateEriCount = duplicateCount([
      ...masterObjects.map(master => master.ERI),
      ...detailObjects.map(detail => detail.ERI),
      ...voucherObjects.map(voucher => voucher.ERI)
    ]);
    audit.orphanMasteriCount = detailObjects.filter(detail => !masterEris.has(detail.MASTERI)).length;

    audit.masterDetailKeyErrorCount = detailObjects.filter(detail => {
      const master = masterByEri.get(detail.MASTERI);
      return !master
        || String(detail.CODE) !== String(master.CODE)
        || String(detail.CUST) !== String(master.CUST)
        || String(detail.SDATE) !== String(master.SDATE)
        || String(detail.GWN) !== String(master.GWN);
    }).length;

    audit.serialSequenceErrorCount = masterObjects.reduce((count, master) => {
      const rows = detailObjects.filter(detail => detail.MASTERI === master.ERI);
      const invalid = rows.some((detail, index) => Number(detail.SERIAL) !== index);
      return count + (invalid ? 1 : 0);
    }, 0);

    audit.orphanSrceriCount = voucherObjects.filter(voucher => !masterEris.has(voucher.SRCERI)).length;

    audit.taxCateErrorCount += detailObjects.filter(detail => {
      const master = masterByEri.get(detail.MASTERI);
      const expectedTaxCate = detail._taxProfile === TAX_PROFILES.exempt.key ? 1 : 0;
      return !master || Number(master.TAXCATE) !== expectedTaxCate;
    }).length;

    audit.masterAmountErrorCount = masterObjects.filter(master => (
      roundTo(
        Number(master.AMT || 0)
        + Number(master.TAX || 0)
        + Number(master.PLUSSUB || 0)
      ) !== roundTo(Number(master.TOTAL || 0))
    )).length;

    audit.detailMasterAmountErrorCount = masterObjects.filter(master => {
      const detailAmount = roundTo(detailObjects
        .filter(detail => detail.MASTERI === master.ERI)
        .reduce((sum, detail) => sum + Number(detail.AMT || 0), 0));
      return detailAmount !== roundTo(master.AMT);
    }).length;

    audit.paymentAssociationErrorCount += voucherObjects.filter(voucher => (
      voucher.SRCERI !== voucher._expectedSrceri
      || !(transactionToMasterSlices.get(voucher._transactionId) || [])
        .some(slice => slice.masterERI === voucher.SRCERI)
    )).length;

    audit.paymentAmountErrorCount += voucherObjects.filter(voucher => (
      Number(voucher.AMT) !== Number(voucher._expectedAmount)
    )).length;

    audit.plusSubErrorCount = masterObjects.filter(master => {
      const expected = roundTo(voucherObjects
        .filter(voucher => voucher.SRCERI === master.ERI)
        .reduce((sum, voucher) => sum + Number(voucher.AMT || 0), 0));
      return roundTo(Number(master.PLUSSUB || 0)) !== expected;
    }).length;

    const voucherRowsByMaster = new Map();
    voucherObjects.forEach(voucher => {
      if (!voucherRowsByMaster.has(voucher.SRCERI)) voucherRowsByMaster.set(voucher.SRCERI, []);
      voucherRowsByMaster.get(voucher.SRCERI).push(voucher);
    });
    audit.voucherSerialSequenceErrorCount = [...voucherRowsByMaster.values()]
      .filter(rows => rows.some((voucher, index) => Number(voucher.SERIAL) !== index))
      .length;

    audit.invoiceFieldErrorCount = masterObjects.filter(master => {
      if (master._invoiceType === 'carrier') {
        return master.CUST !== PERSONAL_CODE
          || master.BILCUST !== PERSONAL_CODE
          || !String(master.REMARK).includes('載具：')
          || !!String(master.POSREMARK1 || '')
          || String(master.CMPID || '') !== '';
      }
      if (master._invoiceType === 'church') {
        return !master.CMPID
          || master.CUST !== master.BILCUST
          || !master.INVNAME
          || String(master.REMARK).includes('統編：')
          || String(master.POSREMARK1).includes('統編：');
      }
      if (master._invoiceType === 'donation') {
        return master.CUST !== BOOK_FAIR_CODE
          || master.BILCUST !== BOOK_FAIR_CODE
          || !String(master.REMARK).includes('捐贈：')
          || !!String(master.POSREMARK1 || '');
      }
      return master.CUST !== BOOK_FAIR_CODE
        || master.BILCUST !== BOOK_FAIR_CODE
        || !!String(master.POSREMARK1 || '');
    }).length;

    audit.costErrorCount = masterObjects.filter(master => (
      roundTo(master.COST) !== roundTo(master._expectedCost)
    )).length;

    const validationLabels = {
      headerErrors: 'CSV header 不符正式 PILOT schema',
      columnCountErrors: 'CSV 欄數錯誤',
      duplicateCodeCount: 'STKSALE1 CODE 重複',
      duplicateEriCount: 'ERI 重複',
      orphanMasteriCount: 'STKSALE2 MASTERI 找不到 master',
      masterDetailKeyErrorCount: 'STKSALE1/STKSALE2 的 CODE、CUST、SDATE、GWN 不一致',
      serialSequenceErrorCount: 'STKSALE2 SERIAL 不是由 0 連續編號',
      orphanSrceriCount: 'VCHRPLUS SRCERI 找不到 master',
      taxCateErrorCount: '商品稅別或 TAXCATE 錯誤',
      masterAmountErrorCount: 'STKSALE1 AMT + TAX + PLUSSUB != TOTAL',
      detailMasterAmountErrorCount: 'STKSALE2 與 master AMT 不平',
      customerResolverErrorCount: '客戶 resolver 錯誤（統編交易須有本場書展教會快照）',
      productResolverErrorCount: 'PRODUCT 正式資料找不到商品',
      transactionIdErrorCount: 'transactionId 缺漏或重複',
      paymentAssociationErrorCount: '付款與 transaction primary master 關聯錯誤',
      paymentAmountErrorCount: '付款金額無效或因拆單不一致',
      plusSubErrorCount: 'STKSALE1.PLUSSUB 與 VCHRPLUS 加減項合計不一致',
      voucherSerialSequenceErrorCount: 'VCHRPLUS SERIAL 未依每個 SRCERI 從 0 連續',
      invoiceFieldErrorCount: '載具／統編／抬頭欄位錯誤',
      costErrorCount: 'COST 與 PRODUCT.CCOST × QTY 不符'
    };

    const validationErrors = Object.entries(validationLabels)
      .filter(([key]) => Number(audit[key]) > 0)
      .map(([key, label]) => {
        const transactionHint = key === 'customerResolverErrorCount' && customerResolverTransactionIds.length
          ? `（交易 ${customerResolverTransactionIds.slice(0, 10).join('、')}）`
          : '';
        const productHint = key === 'productResolverErrorCount' && audit.unresolvedProductCodes.length
          ? `（${audit.unresolvedProductCodes.slice(0, 10).join('、')}）`
          : '';
        return `${label}：${audit[key]}${transactionHint}${productHint}`;
      });

    if (roundTo(audit.exportedGross) !== roundTo(audit.expectedGross)) {
      validationErrors.push(`匯出總額不符：${audit.exportedGross} / ${audit.expectedGross}`);
    }

    return {
      ok: validationErrors.length === 0,
      validationErrors,
      audit,
      rows: {
        stkSale1: s1Rows,
        stkSale2: s2Rows,
        vchrplus: v1Rows
      },
      transactionToPrimaryMasterEri: Object.fromEntries(transactionToPrimaryMasterEri),
      usedEriCount: usedEriSet.size
    };
  }

  return {
    STKSALE1_HEADER,
    STKSALE2_HEADER,
    VCHRPLUS_HEADER,
    buildPilotExport,
    formatDocumentPrefix,
    getPaymentRecords
  };
})();
