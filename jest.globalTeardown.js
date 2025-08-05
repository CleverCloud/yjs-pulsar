module.exports = async () => {
  // Set a timeout to force exit if teardown hangs
  const timeout = setTimeout(() => {
    console.error('Jest teardown timed out. Forcing exit.');
    process.exit(1);
  }, 10000); // 10-second timeout for teardown

  // Clear the timeout if teardown completes in time
  clearTimeout(timeout);
};