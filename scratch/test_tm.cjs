const https = require('https');

async function testSingle(url, auth) {
  const start = Date.now();
  const formData = new URLSearchParams();
  formData.append('trademarks', JSON.stringify(['nike']));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(5000)
    });
    console.log('OK:', url, res.status, (Date.now() - start) + 'ms');
  } catch (err) {
    console.log('FAIL:', url, err.message, (Date.now() - start) + 'ms');
  }
}

async function main() {
  await testSingle('https://uspto-tm-api2.productor.io/search-batch?classes=25,9', 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng==');
  await testSingle('https://euipo-tm-api1.productor.io/search-batch?classes=25,9', 'Basic cHJvZHVjdG9yLW1lcmNoOjc4NzgyaWhvbG5zZmRiKC8mJi9pbzFubml1aDg3OGZhYnV6ZmFzYmprYmtqaGg3MDBoOQ==');
  await testSingle('https://dpma-tm-api2.productor.io/search-batch?classes=25,9', 'Basic cHJvZHVjdG9yLW1lcmNoOjcydWppaW9zZHBoaWhxMDg3MnIzMGc4YmJpJiZ1MWlpODE3Njdnejc2NzU2JTA3Z3V6YXNm');
}

main();
