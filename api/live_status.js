const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  try {
    // Read config.json from project root
    const configPath = path.join(process.cwd(), 'config.json');
    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configContent);
    const members = config.members || {};

    // Parallel async fetch for all members
    const fetchPromises = Object.entries(members).map(async ([key, m]) => {
      const soopId = m.soopId;
      if (!soopId) {
        return {
          member: key,
          name: m.name || "",
          is_live: false,
          profile_image: "",
          broad_title: "SOOP ID 없음",
          url: "#"
        };
      }

      const url = `https://bjapi.afreecatv.com/api/${soopId}/station`;
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(3000) // 3 seconds timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const obj = await response.json();
        let profileImg = obj.profile_image || "";
        if (profileImg && typeof profileImg === 'string' && profileImg.indexOf('//') === 0) {
          profileImg = "https:" + profileImg;
        }

        const broad = obj.broad;
        const isLive = !!broad;

        const resObj = {
          member: key,
          name: m.name || "",
          soopId: soopId,
          is_live: isLive,
          profile_image: profileImg,
        };

        if (isLive) {
          const broadNo = broad.broad_no;
          Object.assign(resObj, {
            broad_title: broad.broad_title || "",
            broad_no: broadNo,
            thumbnail: `https://liveimg.sooplive.com/h/${broadNo}.gif`,
            url: `https://play.sooplive.com/${soopId}/${broadNo}`
          });
        } else {
          Object.assign(resObj, {
            broad_title: "방송 준비 중",
            broad_no: "",
            thumbnail: profileImg,
            url: `https://ch.sooplive.com/${soopId}`
          });
        }
        return resObj;
      } catch (err) {
        return {
          member: key,
          name: m.name || "",
          soopId: soopId,
          is_live: false,
          profile_image: "",
          broad_title: "오프라인 (오류)",
          broad_no: "",
          thumbnail: "",
          url: `https://ch.sooplive.com/${soopId}`,
          error: err.message
        };
      }
    });

    const results = await Promise.all(fetchPromises);
    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
