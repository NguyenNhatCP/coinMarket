const sql = require('mssql');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Log file paths
const LOG_PATH = path.join(__dirname, 'error-log.txt');
const SUCCESS_LOG_PATH = path.join(__dirname, 'success-log.txt');

// Clear previous logs
fs.writeFileSync(LOG_PATH, '');
fs.writeFileSync(SUCCESS_LOG_PATH, '');

// Logging functions
function logToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${timestamp}] ${message}\n`);
}

function logSuccessToFile(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(SUCCESS_LOG_PATH, `[${timestamp}] ${message}\n`);
}

// SQL Server configuration
const config = {
  user: 'sa',
  password: '12345',
  server: '10.30.0.116',
  database: 'CuttingProjectData',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool;

const axiosInstance = axios.create({
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  headers: {
    'X-Powered-By': 'Express',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

async function connectSql() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axiosInstance.get(url, options);
      return response;
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.response?.status === 408) {
        const delay = Math.pow(2, attempt) * 1000;
        const msg = `⚠️ Timeout on attempt ${attempt}, retrying after ${delay} ms...`;
        console.warn(msg);
        logToFile(msg);
        await new Promise(res => setTimeout(res, delay));
      } else {
        logToFile(`❌ Axios error: ${err.message}`);
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded.');
}

async function fetchTotalPages(fromDate, toDate) {
  const url = `http://10.30.0.36:3100/getTotalPages?fromDate=${fromDate}&toDate=${toDate}`;
  try {
    const res = await axios.get(url);
    return res.data.data || 0;
  } catch (err) {
    const msg = `❌ Failed to get total pages: ${err.message}`;
    console.error(msg);
    logToFile(msg);
    return 0;
  }
}

async function fetchPageData(fromDate, toDate, page, retries = 0, maxRetries = 5, delay = 3000) {
  const url = `http://10.30.0.36:3100/getDataCuttingByPlanPC?fromDate=${fromDate}&toDate=${toDate}&page=${page}`;
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'X-Powered-By': 'Express',
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    return Array.isArray(response.data?.data) ? response.data.data : [];
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const serverMsg = err.response?.data?.message || '';
      const msg = `❌ Failed to fetch page ${page}: ${err.message}`;
      console.error(msg);
      logToFile(msg);
      if (serverMsg.toLowerCase().includes("come back in 3 mi") && retries < maxRetries) {
        const waitTime = delay * Math.pow(2, retries);
        const retryMsg = `⏳ Waiting ${waitTime / 1000}s before retrying (Attempt ${retries + 1}/${maxRetries})`;
        console.warn(retryMsg);
        logToFile(retryMsg);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchPageData(fromDate, toDate, page, retries + 1, maxRetries, delay);
      }
    }
    return [];
  }
}

async function insertData(data) {
  const pool = await connectSql();

  for (let item of data) {
    try {
      const productResult = await pool.request()
        .input('ART', sql.NVarChar, item.ART)
        .query('SELECT ProductID FROM Product WHERE ART = @ART');
      const productId = productResult.recordset.length
        ? productResult.recordset[0].ProductID
        : (await pool.request()
            .input('ART', sql.NVarChar, item.ART)
            .input('Model', sql.NVarChar, item.Model)
            .query('INSERT INTO Product (ART, Model) OUTPUT INSERTED.ProductID VALUES (@ART, @Model)')
          ).recordset[0].ProductID;

      const materialResult = await pool.request()
        .input('MaterialCode', sql.NVarChar, item['Materials ID'])
        .query('SELECT MaterialID FROM Material WHERE MaterialCode = @MaterialCode');
      const materialId = materialResult.recordset.length
        ? materialResult.recordset[0].MaterialID
        : (await pool.request()
            .input('MaterialCode', sql.NVarChar, item['Materials ID'])
            .input('MaterialName', sql.NVarChar, item['Materials Name'])
            .query('INSERT INTO Material (MaterialCode, MaterialName) OUTPUT INSERTED.MaterialID VALUES (@MaterialCode, @MaterialName)')
          ).recordset[0].MaterialID;

      const orderResult = await pool.request()
        .input('Factory', sql.NVarChar, item.Factory)
        .input('SO', sql.NVarChar, item.SO)
        .input('PO', sql.NVarChar, item.PO)
        .query('SELECT OrderID FROM ProductOrder WHERE Factory = @Factory AND SO = @SO AND PO = @PO');
      const orderId = orderResult.recordset.length
        ? orderResult.recordset[0].OrderID
        : (await pool.request()
            .input('ProductId', sql.Int, productId)
            .input('Factory', sql.NVarChar, item.Factory)
            .input('SO', sql.NVarChar, item.SO)
            .input('PO', sql.NVarChar, item.PO)
            .input('MasterWorkOrder', sql.NVarChar, item['Master Work Order'])
            .input('LastNo', sql.NVarChar, item['Last No'])
            .input('Process', sql.NVarChar, item['Production Process'])
            .query(`INSERT INTO ProductOrder (ProductId, Factory, SO, PO, MasterWorkOrder, LastNo, Process)
                    OUTPUT INSERTED.OrderID VALUES (@ProductId, @Factory, @SO, @PO, @MasterWorkOrder, @LastNo, @Process)`)
          ).recordset[0].OrderID;

      const sizeResult = await pool.request()
        .input('Size', sql.NVarChar, item.Size)
        .query('SELECT SizeID FROM Size WHERE Size = @Size');
      const sizeId = sizeResult.recordset.length
        ? sizeResult.recordset[0].SizeID
        : (await pool.request()
            .input('Size', sql.NVarChar, item.Size)
            .query('INSERT INTO Size (Size) OUTPUT INSERTED.SizeID VALUES (@Size)')
          ).recordset[0].SizeID;

      const partResult = await pool.request()
        .input('PartCode', sql.NVarChar, item['Part Id'])
        .input('PartName', sql.NVarChar, item['Part Name'])
        .query('SELECT PartID FROM Part WHERE PartCode = @PartCode AND PartName = @PartName');
      const partId = partResult.recordset.length
        ? partResult.recordset[0].PartID
        : (await pool.request()
            .input('PartName', sql.NVarChar, item['Part Name'])
            .input('PartCode', sql.NVarChar, item['Part Id'])
            .query('INSERT INTO Part (PartName, PartCode) OUTPUT INSERTED.PartID VALUES (@PartName, @PartCode)')
          ).recordset[0].PartID;

      const checkPSO = await pool.request()
        .input('PartId', sql.Int, partId)
        .input('OrderId', sql.Int, orderId)
        .input('SizeId', sql.Int, sizeId)
        .query('SELECT COUNT(*) AS Count FROM PartSizeOrder WHERE PartId = @PartId AND OrderId = @OrderId AND SizeId = @SizeId');
      if (checkPSO.recordset[0].Count === 0) {
        await pool.request()
          .input('PartId', sql.Int, partId)
          .input('MaterialId', sql.Int, materialId)
          .input('OrderId', sql.Int, orderId)
          .input('SizeId', sql.Int, sizeId)
          .input('SizeQty', sql.Int, item['Size Qty'])
          .input('Unit', sql.NVarChar, item.UNIT)
          .input('UnitUsage', sql.Float, item.TargetCut)
          .input('TargetCut', sql.Int, item.TargetCut)
          .query(`INSERT INTO PartSizeOrder (MaterialId, PartId, OrderId, SizeId, SizeQty, Unit, UnitUsage,TargetCut)
                  VALUES (@MaterialId, @PartId, @OrderId, @SizeId, @SizeQty, @Unit, @UnitUsage, @TargetCut)`);
      }

      // Optional success log per record (can be commented to reduce file size)
      logSuccessToFile(`✔️ Inserted: ART=${item.ART}, Part=${item['Part Name']}, Size=${item.Size}`);

    } catch (err) {
      const errMsg = `❌ Insert failed for ART=${item.ART}: ${err.message}`;
      console.error(errMsg);
      logToFile(errMsg);
    }
  }

  console.log(`✅ Inserted ${data.length} records.`);
}

async function runSync() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0'); // months are 0-based
  const dd = String(today.getDate()).padStart(2, '0');
  const formattedDate = `${yyyy}-${mm}-${dd}`;

  const startdate = formattedDate;
  const endate = formattedDate;
  const totalPages = await fetchTotalPages(startdate, endate);

  for (let page = 1; page <= totalPages; page++) {
    let attempts = 0;
    let pageData = [];

    do {
      console.log(`📦 Fetching page ${page}/${totalPages} (Attempt ${attempts + 1})`);
      pageData = await fetchPageData(startdate, endate, page);

      if (pageData.length === 0 && page === 1) {
        attempts++;
        const msg = `⚠️ No data on page 1. Retrying (${attempts}/3)...`;
        console.warn(msg);
        logToFile(msg);
        await new Promise(res => setTimeout(res, 1000));
      } else {
        break;
      }
    } while (page === 1 && attempts < 3);

    if (pageData.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < pageData.length; i += batchSize) {
        const chunk = pageData.slice(i, i + batchSize);
        try {
          await insertData(chunk);
          logSuccessToFile(`✅ Inserted chunk (page ${page}, records ${i + 1}-${i + chunk.length})`);
        } catch (err) {
          const msg = `🚨 Failed to insert chunk (page ${page}): ${err.message}`;
          console.error(msg);
          logToFile(msg);
        }
        await new Promise(res => setTimeout(res, 200));
      }
    } else {
      const msg = `⚠️ No data found on page ${page} after retries.`;
      console.log(msg);
      logToFile(msg);
    }
  }

  await sql.close();
  console.log("🎉 Data sync complete.");
  logSuccessToFile("🎉 Data sync complete.");
}

runSync().catch(err => {
  const errMsg = `🔥 Unexpected error: ${err.stack || err.message}`;
  console.error(errMsg);
  logToFile(errMsg);
  sql.close();
});
