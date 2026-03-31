module.exports = {
  apps: [
    {
      name: "my-app",
      script: "npm",
      args: "start",
      // Use cmd.exe as the interpreter to correctly handle .cmd files
      interpreter: "C:\\Windows\\System32\\cmd.exe",
      // The '/c' flag tells cmd to run the command and then terminate
      interpreter_args: "/c"
    }
  ]
};
