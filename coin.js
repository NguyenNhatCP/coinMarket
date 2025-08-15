const express = require("express");
const app = express();
const PORT = 3000;

app.use(express.json());

let savedTokens = [];

app.post("/save-token", (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }
  if (!savedTokens.includes(token)) {
    savedTokens.push(token);
    console.log("Token saved:", token);
  }
  res.json({ message: "Token received" });
});

app.get("/", (req, res) => {
  res.send("Push notification server is running!");
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
