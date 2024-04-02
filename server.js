const fs = require("fs");
const express = require("express");
const sharp = require("sharp");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const cors = require("cors");

const server = app.listen(80, () => {});

const pool = new Pool({
    user: "root",
    host: "localhost",
    database: "new_york",
    password: "password",
    port: 5432, // Default PostgreSQL port
});

process.on("SIGINT", () => {
    server.close(() => {
        pool.end();
        process.exit(0);
    });
});

app.use(
    cors({
        origin: "http://localhost:80",
        methods: ["POST", "PUT", "GET", "OPTIONS", "HEAD"],
        credentials: true,
    })
);

//Middleware to parse requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Header group id middleware
app.use((req, res, next) => {
    res.setHeader("X-CSE356", "65bae34dc5cd424f68b46147");
    next();
});

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

app.get("/index.html", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

app.get("/index.css", (req, res) => {
    res.sendFile(__dirname + "/index.css");
});

app.get("/index.js", (req, res) => {
    res.sendFile(__dirname + "/index.js");
});

app.get("/tiles/:l/:v/:h.png", async (req, res) => {
    const { l, v, h } = req.params;
    const result = await fetch(`http://209.94.57.1/tile/${l}/${v}/${h}.png`);
    res.setHeader("Content-Type", "image/png");
    result.body.pipe(res);
});

app.post("/api/search", (req, res) => {
    const bbox = req.body.bbox;
    const onlyInBox = req.body.onlyInBox;

    const searchSet = {};
    const searchTerm = req.body.searchTerm;
    for (const word of searchTerm.toLowerCase().split(" ")) {
        searchSet[word] = true;
    }

    var pointQuery =
        "SELECT p.*, ST_X(ST_Transform(p.way, 4326)) AS longitude, ST_Y(ST_Transform(p.way, 4326)) AS latitude FROM planet_osm_point p " +
        "WHERE amenity IS NOT NULL AND name IS NOT NULL " +
        "AND ST_Intersects(p.way, ST_Transform(ST_SetSRID(ST_MakeEnvelope(" +
        bbox.minLon +
        ", " +
        bbox.minLat +
        ", " +
        bbox.maxLon +
        ", " +
        bbox.maxLat +
        ", 4326), 4326), 3857));";

    var polygonQuery =
        "SELECT p.*, ST_X(ST_Transform(ST_Centroid(p.way), 4326)) AS longitude, ST_Y(ST_Transform(ST_Centroid(p.way), 4326)) AS latitude FROM planet_osm_polygon p " +
        "WHERE amenity IS NOT NULL AND name IS NOT NULL " +
        "AND ST_Intersects(p.way, ST_Transform(ST_SetSRID(ST_MakeEnvelope(" +
        bbox.minLon +
        ", " +
        bbox.minLat +
        ", " +
        bbox.maxLon +
        ", " +
        bbox.maxLat +
        ", 4326), 4326), 3857));";

    var testCombinedQuery = `
        SELECT
            name,
            "addr:housenumber" AS housenumber,
            tags -> 'addr:street' AS street,
            tags -> 'addr:city' AS city,
            tags -> 'addr:state' AS state,
            tags -> 'addr:postcode' AS zip,
            ST_X(ST_Transform(way, 4326)) AS longitude, 
            ST_Y(ST_Transform(way, 4326)) AS latitude
        FROM planet_osm_point
        WHERE name ILIKE $1
        OR "addr:housenumber" LIKE $1
        OR tags -> 'addr:street' ILIKE $1
        OR tags -> 'addr:postcode' LIKE $1

        UNION

        SELECT
            name,
            "addr:housenumber" AS housenumber,
            tags -> 'addr:street' AS street,
            tags -> 'addr:city' AS city,
            tags -> 'addr:state' AS state,
            tags -> 'addr:postcode' AS zip,
            ST_X(ST_Transform(ST_Centroid(way), 4326)) AS longitude,
            ST_Y(ST_Transform(ST_Centroid(way), 4326)) AS latitude
        FROM planet_osm_polygon
        WHERE name ILIKE $1
        OR "addr:housenumber" LIKE $1
        OR tags -> 'addr:street' ILIKE $1
        OR tags -> 'addr:postcode' LIKE $1

        UNION

        SELECT
            name,
            "addr:housenumber" AS housenumber,
            tags -> 'addr:street' AS street,
            tags -> 'addr:city' AS city,
            tags -> 'addr:state' AS state,
            tags -> 'addr:postcode' AS zip,
            ST_X(ST_Transform(ST_Centroid(way), 4326)) AS longitude,
            ST_Y(ST_Transform(ST_Centroid(way), 4326)) AS latitude
        FROM planet_osm_line
        WHERE name ILIKE $1;
    `

    if (req.body.onlyInBox == true) {
        //only get center coordinates of visible portion inside bbox
        let intersection =
            "ST_Centroid(ST_Intersection(p.way, ST_MakeEnvelope(" +
            bbox.minLon +
            ", " +
            bbox.minLat +
            ", " +
            bbox.maxLon +
            ", " +
            bbox.maxLat +
            ", 3857)))";

        polygonQuery =
            "SELECT p.*, ST_X(ST_Transform(ST_Centroid(p.way), 4326)) AS longitude, ST_Y(ST_Transform(ST_Centroid(p.way), 4326)) AS latitude, " +
            "ST_X(" +
            intersection +
            ") AS longitude, ST_Y(" +
            intersection +
            ") AS latitude FROM planet_osm_polygon p ";
        "WHERE amenity IS NOT NULL AND name IS NOT NULL " +
            "AND ST_Intersects(p.way, ST_Transform(ST_SetSRID(ST_MakeEnvelope(" +
            bbox.minLon +
            ", " +
            bbox.minLat +
            ", " +
            bbox.maxLon +
            ", " +
            bbox.maxLat +
            ", 4326), 4326), 3857));";
    }

    // let pointQuery = "SELECT p.*, ST_AsText(ST_Transform(ST_Centroid(p.way), 4326)) AS center_coordinates " +
    // "FROM planet_osm_point p " +
    // "WHERE amenity IS NOT NULL AND name IS NOT NULL " +
    // "AND ST_Intersects(way, ST_Transform(ST_SetSRID(ST_MakeEnvelope(" + bbox.minLat +", " + bbox.minLon + ", " + bbox.maxLat + ", " + bbox.maxLon + ", 4326), 4326), 3857));";

    // let polygonQuery = "SELECT p.*, ST_AsText(ST_Transform(ST_Centroid(p.way), 4326)) AS center_coordinates " +
    // "FROM planet_osm_polygon p " +
    // "WHERE amenity IS NOT NULL AND name IS NOT NULL " +
    // "AND ST_Intersects(way, ST_Transform(ST_SetSRID(ST_MakeEnvelope(" + bbox.minLat +", " + bbox.minLon + ", " + bbox.maxLat + ", " + bbox.maxLon + ", 4326), 4326), 3857));";

    // if(req.body.onlyInBox == true){ //
    //     polygonQuery = "SELECT p.*, ST_AsText(ST_Transform(ST_Centroid(ST_Intersection(p.way, bbox.bbox_geom)), 4326)) AS center_coordinates " +
    //     "FROM planet_osm_polygon p JOIN (SELECT ST_Transform(ST_SetSRID(ST_MakeEnvelope(" + bbox.minLat + ", " + bbox.minLon + ", " + bbox.maxLat + ", " + bbox.maxLon + ", 4326), 4326), 3857) AS bbox_geom) AS bbox ON ST_Intersects(p.way, bbox.bbox_geom) " +
    //     "WHERE boundary IS NOT NULL AND amenity IS NOT NULL AND name IS NOT NULL;"

    //     pointQuery = "SELECT p.*, ST_AsText(ST_Transform(ST_Centroid(ST_Intersection(p.way, bbox.bbox_geom)), 4326)) AS center_coordinates " +
    //     "FROM planet_osm_point p JOIN (SELECT ST_Transform(ST_SetSRID(ST_MakeEnvelope(" + bbox.minLat + ", " + bbox.minLon + ", " + bbox.maxLat + ", " + bbox.maxLon + ", 4326), 4326), 3857) AS bbox_geom) AS bbox ON ST_Intersects(p.way, bbox.bbox_geom) " +
    //     "WHERE boundary IS NOT NULL AND amenity IS NOT NULL AND name IS NOT NULL;"
    // }

    // Execute the query
    pool.query(testCombinedQuery, [`%${searchTerm}%`])
        .then((queryResult) => {
            const resultRows = queryResult.rows;
            console.log(resultRows);

            let out = [];
            for (const row of resultRows) {
                let outObj = {};
                outObj["lat"] = row.latitude;
                outObj["lon"] = row.longitude;
                outObj["name"] = "";
                if (row.name) {
                    outObj["name"] = row.name;
                } else {
                    outObj["name"] += row.housenumber ? row.housenumber : ""
                    outObj["name"] += row.street ? row.street + ", " : ""
                    outObj["name"] += row.city ? row.city + ", " : ""
                    outObj["name"] += row.state ? row.state + " ": ""
                    outObj["name"] += row.zip ? row.zip : ""
                }
                out.push(outObj);
            }
            res.send(out);
        })
        .catch((error) => {
            res.status(500).send(error);
            console.log(error);
        })

    // pool.query(pointQuery)
    //     .then((pointResults) => {
    //         pool.query(polygonQuery)
    //             .then((polygonResults) => {
    //                 const results = [];
    //                 for (const result of pointResults.rows.concat(
    //                     polygonResults.rows
    //                 )) {
    //                     var added = false;
    //                     for (const word of result.name
    //                         .toLowerCase()
    //                         .split(" ")) {
    //                         if (word in searchSet) {
    //                             results.push(result);
    //                             added = true;
    //                             break;
    //                         }
    //                     }

    //                     if (added) continue;

    //                     for (const word of result.amenity
    //                         .toLowerCase()
    //                         .split(" ")) {
    //                         if (word in searchSet) {
    //                             results.push(result);
    //                             added = true;
    //                             break;
    //                         }
    //                     }

    //                     if (added) continue;

    //                     if (result.brand != null) {
    //                         for (const word of result.brand
    //                             .toLowerCase()
    //                             .split(" ")) {
    //                             if (word in searchSet) {
    //                                 results.push(result);
    //                                 break;
    //                             }
    //                         }
    //                     }
    //                 }
    //                 res.send(results);
    //             })
    //             .catch((error) => {
    //                 res.status(500).send(error);
    //                 console.log(error);
    //             });
    //     })
    //     .catch((error) => {
    //         res.status(500).send(error);
    //         console.log(error);
    //     });
});

app.post("/convert", (req, res) => {
    const lat = req.body.lat;
    const long = req.body.long;
    const zoom = req.body.zoom;

    // Implementing formula for lat/long/zoom to tile numbers
    const n = Math.pow(2, zoom);
    const xTile = Math.floor(n * ((long + 180) / 360));
    const yTile = Math.floor(n * (1 - (Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)) / 2);

    res.json({
        "x_tile": xTile,
        "y_tile": yTile
    });
});
