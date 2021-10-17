const express = require('express')
const CORS = require('cors')
const app = express()
const port = 9999
const parser = require('./parser.js');

let corsOptions = {
    origin: "*",
    optionsSuccessStatus: 200
}

let graph = {
    nodes: [],
    edges: []
}

app.use((req, res, next)=>{
    console.log(req.url, req.body);
    next();
}, CORS(corsOptions))

app.options('*', (req, res) => {
    res.writeHead(200, 'ok', {
        'Access-Control-Allow-Origin': '*'
    })
    res.send('ok');
})

app.get('/graph', async (req, res) => {
    let data = await parser.parse();
    res.json(data);
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})