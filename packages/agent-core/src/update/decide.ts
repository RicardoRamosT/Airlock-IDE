// Where can we put the new bundle? Writable install dir -> swap in place;
// otherwise reveal the downloaded DMG for a manual drag-install.
export function chooseUpdateAction(opts: {
  installDirWritable: boolean;
}): "swap" | "reveal" {
  return opts.installDirWritable ? "swap" : "reveal";
}
