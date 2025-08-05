module.exports = async () => {
  const timeout = setTimeout(() => {
    console.error('Jest setup timed out. Forcing exit.');
    process.exit(1);
  }, 30000); // 30-second timeout for setup

  // Clear the timeout if setup completes in time
  clearTimeout(timeout);
};