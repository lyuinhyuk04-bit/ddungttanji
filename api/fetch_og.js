module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url: targetUrl } = req.query;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    
    // 1. Fetch HTML of the target URL
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': userAgent
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: `Failed to fetch target URL: ${response.status} ${response.statusText}` });
    }

    const html = await response.text();

    // Helper to extract tag content
    const getMetaTag = (property) => {
      const regexes = [
        new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["'](.*?)["']`, 'i'),
        new RegExp(`<meta\\s+content=["'](.*?)["']\\s+property=["']${property}["']`, 'i'),
        new RegExp(`<meta\\s+name=["']${property}["']\\s+content=["'](.*?)["']`, 'i'),
        new RegExp(`<meta\\s+content=["'](.*?)["']\\s+name=["']${property}["']`, 'i')
      ];
      for (const regex of regexes) {
        const match = html.match(regex);
        if (match && match[1]) {
          // Decode HTML entities
          return match[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&#39;/g, "'");
        }
      }
      return '';
    };

    // Extract title, description, image, and canonical URL
    let title = getMetaTag('og:title');
    if (!title) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1];
      }
    }

    const description = getMetaTag('og:description') || getMetaTag('description');
    const ogImage = getMetaTag('og:image');
    
    let imageBase64 = '';

    // 2. Fetch the image and convert to Base64 to bypass CORS/Hotlinking blocks
    if (ogImage) {
      try {
        // Resolve relative image URLs if necessary
        let absoluteImageUrl = ogImage;
        if (ogImage.startsWith('//')) {
          absoluteImageUrl = 'https:' + ogImage;
        } else if (ogImage.startsWith('/')) {
          const parsedTarget = new URL(targetUrl);
          absoluteImageUrl = parsedTarget.origin + ogImage;
        }

        const imgResp = await fetch(absoluteImageUrl, {
          headers: { 'User-Agent': userAgent }
        });

        if (imgResp.ok) {
          const arrayBuffer = await imgResp.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
          imageBase64 = `data:${contentType};base64,${buffer.toString('base64')}`;
        }
      } catch (imgErr) {
        console.error('Failed to convert OG image to Base64:', imgErr);
      }
    }

    return res.status(200).json({
      title: title || '',
      description: description || '',
      image: imageBase64 || '',
      link: targetUrl
    });
  } catch (err) {
    console.error('API Fetch OG Exception:', err);
    return res.status(500).json({ error: err.message });
  }
};
