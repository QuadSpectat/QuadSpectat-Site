import express from 'express'
import multer from 'multer'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// POST /api/cog/convert
router.post('/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const inputPath = req.file.path
    const outputName = req.body.outputName || (req.file.originalname.replace(/\.[^.]+$/, '_cog.tif'))
    const outputPath = path.join('uploads', outputName)

    // Build GDAL command
    const cmd = `gdalwarp -t_srs EPSG:3857 -r bilinear -of COG -co COMPRESS=LZW -co OVERVIEW_LEVEL=AUTO -co BIGTIFF=IF_SAFER "${inputPath}" "${outputPath}"`

    exec(cmd, (err, stdout, stderr) => {
      // Clean up input file
      fs.unlinkSync(inputPath)
      if (err) {
        return res.status(500).json({ error: stderr || err.message })
      }
      // Optionally: send file, or just success
      res.json({ success: true, output: outputName })
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
