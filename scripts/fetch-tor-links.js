const https = require('https');

https.get('https://www.torproject.org/download/tor/', (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        const links = data.match(/https:\/\/[^\s\"]*\.(exe|dmg|tar\.gz|apk)/g);
        if (links) {
            console.log('Extracted links:');
            links.forEach(link => console.log(link));
        } else {
            console.log('No links found.');
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});