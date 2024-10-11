const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const csv = require("csv-parser");
const fs = require("fs");

const app = express();
const path = require("path");
const upload = multer({ dest: "uploads/" });

const db = mysql.createConnection({
  host: "127.0.0.1",
  port: 3306, 
  user: "root", 
  password: "Tuandoan@2404",
  database: "chuyenkhoan",
});

db.connect((err) => {
  if (err) throw err;
  console.log("Kết nối đến cơ sở dữ liệu thành công.");
});

app.use(express.urlencoded({ extended: true }));
app.use("/bootstrap/css", express.static(path.join(__dirname, "node_modules/bootstrap/dist/css")));
app.use("/bootstrap/js", express.static(path.join(__dirname, "node_modules/bootstrap/dist/js")));
app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("public"));

function formatDateTime(dateTime) {
  const date = new Date(dateTime);
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };
  return date.toLocaleString("vi-VN", options).replace(",", "");
}

function formatCurrency(amount) {
  return (
    amount
      .toLocaleString("vi-VN") // Định dạng số với dấu phẩy hàng nghìn
      .trim() + " đ" // Thêm " đ" vào cuối
  );
}

app.get("/", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit; // tính trang hiện tại

  const sql = `SELECT * FROM chuyenkhoan ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;

  db.query("SELECT COUNT(*) as total FROM chuyenkhoan", (err, result) => {
    if (err) {
      console.error("Lỗi: " + err);
      return res.status(500).render("pages/home", { data: [], stats: {}, currentPage: page, totalPages: 0 });
    }

    const totalRecords = result[0].total; //tính ra tổng số bản ghi => 200347
    const totalPages = Math.ceil(totalRecords / limit); 

    db.query(sql, (err, data) => {
      if (err) {
        console.error("Lỗi: " + err);
        return res.status(500).render("pages/home", { data: [], currentPage: page, totalPages, stats: {} });
      }
      
      res.render("pages/home", {
        data: data || [],
        currentPage: page,
        totalPages: totalPages,
        formatDateTime,
        formatCurrency,
        stats: {},
        filters: {}
      });
    });
  });
});

app.get("/filters", (req, res) => {
  const { startDate, endDate, minAmount, maxAmount, transactionDetail, page = 1 } = req.query;

  let conditions = []; //nhận dk lọc
  let values = [];//nhận values lọc
  
  //kiểm tra có cái nào thì nhận vào cái đó
  if (startDate) {
      conditions.push("date_time >= ?");
      values.push(startDate);
  }

  if (endDate) {
      conditions.push("date_time <= ?");
      values.push(endDate);
  }

  if (minAmount) {
      conditions.push("credit >= ?");
      values.push(minAmount);
  }

  if (maxAmount) {
      conditions.push("credit <= ?");
      values.push(maxAmount);
  }

  if (transactionDetail) {
      conditions.push("detail LIKE ?");
      values.push(`%${transactionDetail}%`);
  }

  const baseSQL = "SELECT * FROM chuyenkhoan";
  //countSQL get total giao dịch, total money
  const countSQL = "SELECT COUNT(*) as total, SUM(credit) as totalAmount FROM chuyenkhoan" + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
  
  const limit = 20;
  const offset = (page - 1) * limit;

  const sql = baseSQL + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') + ` ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;

  const startTime = Date.now();

  db.query(countSQL, values, (err, countResult) => {
      if (err) {
          console.error("Lỗi: " + err);
          return res.status(500).render("pages/home", { data: [], stats: {}, currentPage: page, totalPages: 0 });
      }

      const totalRecords = countResult[0].total;
      const totalAmount = countResult[0].totalAmount || 0; 
      const totalPages = Math.ceil(totalRecords / limit);//ceil: làm tròn số trang, ví dụ 6.25 thì lên

      db.query(sql, values, (err, data) => {
          if (err) {
              console.error("Lỗi: " + err);
              return res.status(500).render("pages/home", { data: [], stats: {}, currentPage: page, totalPages: 0 });
          }

          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(2);

          res.render("pages/home", {
              data: data || [],
              currentPage: parseInt(page),
              totalPages: totalPages,
              formatDateTime,
              formatCurrency,
              stats: {
                  totalAmount,
                  transactionCount: totalRecords,
                  duration
              },
              filters: {
                  startDate,
                  endDate,
                  minAmount,
                  maxAmount,
                  transactionDetail,
              }
          });
      });
  });
});

app.post("/upload", upload.single("csvFile"), (req, res) => {
  let records = [];
  const batchSize = 1000;


  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => {
      const cleanedData = {};
      for (const key in data) {
        const cleanedKey = key.replace(/['"]/g, "").trim();
        cleanedData[cleanedKey] = data[key];
      }
      records.push(cleanedData);
    })
    .on("end", async () => {

      // Kiểm tra xem các bản ghi đã tồn tại trong SQL hay chưa
      const existingRecords = await checkExistingRecords(records);

      if (existingRecords.length > 0) {
        // Nếu đã tồn tại, chuyển hướng đến trang home với thông báo
        return res.render("pages/home", {
          message: "Có bản ghi đã tồn tại. Bạn có muốn ghi đè không?",
          filePath: req.file.path, // Gửi đường dẫn file
          filters: req.body.filters || {}, // Truyền filters nếu có
        });
      }
      let listDatas = [];
      const startTime = Date.now();

      const insertBatch = (batch) => {
        return new Promise((resolve, reject) => {
          const sql = `INSERT INTO chuyenkhoan (date_time, trans_no, credit, debit, detail) VALUES ${batch.join(", ")}`;
          db.query(sql, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      };

      for (const record of records) {
        let dates = record.date_time;
        let [datePart, timePart] = dates.split("_");
        let [day, month, year] = datePart.split("/");
        let formattedDate = `${year}-${month}-${day}`;

        let totalMinutes = Math.floor(parseFloat(timePart));
        let totalSeconds = totalMinutes * 60 + Math.floor((parseFloat(timePart) % 1) * 60);

        const padNumber = (num) => String(num).padStart(2, "0");

        const formatTime = (totalSeconds) => {
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          const displayHours = hours % 24;

          return `${padNumber(displayHours)}:${padNumber(minutes)}:${padNumber(seconds)}`;
        };

        let formattedTime = formatTime(totalSeconds);
        let dateTime = `${formattedDate} ${formattedTime}`;
        const transNo = record.trans_no;
        const credit = record.credit;
        const debit = record.debit;
        const detail = record.detail;

        listDatas.push(`('${dateTime}', '${transNo}', '${credit}', '${debit}', '${detail}')`);

        if (listDatas.length === batchSize) {
          await insertBatch(listDatas);
          listDatas = [];
        }
      }

      if (listDatas.length > 0) {
        await insertBatch(listDatas);
      }

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      res.send(`Upload thành công. Tải lên SQL: ${duration} Giây.`);
    });
});

// Hàm kiểm tra bản ghi đã tồn tại
async function checkExistingRecords(records) {
  const existingRecords = [];

  for (const record of records) {
    const transNo = record.trans_no; //check 1 cột trans_no
    const query = `SELECT * FROM chuyenkhoan WHERE trans_no = ?`;
    
    const result = await new Promise((resolve, reject) => {
      db.query(query, [transNo], (err, results) => {
        if (err) {
          return reject(err);
        }
        resolve(results);
      });
    });

    if (result.length > 0) {
      existingRecords.push(transNo); // Thêm bản ghi đã tồn tại vào danh sách
    }
  }

  return existingRecords;
}
app.listen(4001, () => {
  console.log("Server Started on http://localhost:4001");
});