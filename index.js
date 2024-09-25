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

app.use(
  "/bootstrap/css",
  express.static(path.join(__dirname, "node_modules/bootstrap/dist/css"))
);
app.use(
  "/bootstrap/js",
  express.static(path.join(__dirname, "node_modules/bootstrap/dist/js"))
);

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
      .toLocaleString("vi-VN", { style: "currency", currency: "VND" })
      .replace("₫", "")
      .trim() + " đ"
  );
}

app.get("/", (req, res) => {
  const page = parseInt(req.query.page) || 1; // Lấy số trang từ query
  const limit = 15;
  const offset = (page - 1) * limit; // Tính offset dựa trên số trang

  const sql = `SELECT * FROM chuyenkhoan ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;

  // Truy vấn tổng số bản ghi để tính số trang
  db.query("SELECT COUNT(*) as total FROM chuyenkhoan", (err, result) => {
    if (err) {
      console.error("Lỗi: " + err);
      return res.status(500).render("pages/home", { data: [] });
    }

    const totalRecords = result[0].total; // Tổng số bản ghi
    const totalPages = Math.ceil(totalRecords / limit); // Tổng số trang

    db.query(sql, (err, data) => {
      if (err) {
        console.error("Lỗi: " + err);
        return res.status(500).render("pages/home", { data: [] });
      }

      res.render("pages/home", {
        data: data || [],
        currentPage: page,
        totalPages: totalPages,
        formatDateTime,
        formatCurrency,
      });
    });
  });
});

app.post("/upload", upload.single("csvFile"), (req, res) => {
  const results = [];
  const batchSize = 5000;

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => {
      const cleanedData = {};
      for (const key in data) {
        const cleanedKey = key.replace(/['"]/g, "").trim();
        cleanedData[cleanedKey] = data[key];
      }
      results.push(cleanedData);
    })
    .on("end", async () => {
      // Thay đổi để sử dụng async
      console.log(`Length: ${results.length}`);

      let batches = [];
      const insertStartTime = Date.now();

      // Hàm chèn dữ liệu vào SQL
      const insertBatch = (batches) => {
        return new Promise((resolve, reject) => {
          const sql = `INSERT INTO chuyenkhoan (date_time, trans_no, credit, debit, detail) VALUES ${batches.join(
            ", "
          )}`;
          db.query(sql, (err) => {
            if (err) {
              console.error("Lỗi: " + err);
              reject(err);
            } else {
              resolve();
            }
          });
        });
      };

      // Duyệt qua từng hàng dữ liệu
      for (const row of results) {
        let dates = row["date_time"];
        let [datePart, timePart] = dates.split("_");
        let [day, month, year] = datePart.split("/");
        let formattedDate = `${year}-${month}-${day}`;

        let totalMinutes = Math.floor(parseFloat(timePart));

        //lấy s bằng tổng minutes * 60 và + phần thập phân phía sau * 60
        let totalSeconds =
          totalMinutes * 60 + Math.floor((parseFloat(timePart) % 1) * 60);

          //hàm chuyển thành chuỗi từ số //ex: 1 -> '01' hoặc 15 -> '15'
        const padNumber = (num) => String(num).padStart(2, "0");

        const formatTime = (totalSeconds) => {
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const seconds = totalSeconds % 60;

          const displayHours = hours % 24;

          return `${padNumber(displayHours)}:${padNumber(minutes)}:${padNumber(
            seconds
          )}`;
        };

        let formattedTime = formatTime(totalSeconds);
        let date_time = `${formattedDate} ${formattedTime}`;

        const trans_no = row.trans_no;
        const credit = row.credit;
        const debit = row.debit;
        const detail = row.detail;

        batches.push(
          `('${date_time}', '${trans_no}', '${credit}', '${debit}', '${detail}')`
        );

        if (batches.length === batchSize) {
          await insertBatch(batches); // Chờ cho đến khi chèn xong
          batches.length = 0; // Reset batch
        }
      }

      // Chèn nếu còn lại dữ liệu trong batches
      if (batches.length > 0) {
        await insertBatch(batches); // Chờ cho đến khi chèn xong
      }

      const insertEndTime = Date.now();

      //insertEndTime - insertStartTime -> mili giây và /1000 để chuyển sang giây
      const insertTimeTaken = (
        (insertEndTime - insertStartTime) /
        1000
      ).toFixed(2);

      res.send(
        `Dữ liệu đã được tải lên thành công. Thời gian chèn vào SQL: ${insertTimeTaken} giây.`
      );
    });
});

app.listen(4001, () => {
  console.log("Server Started on http://localhost:4001");
});
