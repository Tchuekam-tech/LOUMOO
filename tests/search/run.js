require('../setup');
(async () => {
  for (const name of ['database', 'service', 'browser'])
    await require(`./${name}.test`)();
  console.log('PASS universal search: all isolated suites');
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
