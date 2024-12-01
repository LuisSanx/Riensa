const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { add } = require('node-7z');
const jwt = require('jsonwebtoken'); // JWT para enlaces seguros

const app = express();
const PORT = 3000;
const SECRET_KEY = 'supersecreto'; // Clave secreta para JWT
const EXPIRATION_TIME = 2 * 24 * 60 * 60 * 1000; // 2 dias 

app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Verificar y crear la carpeta uploads si no existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de multer para subir archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Configuración del transporte de correo
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'robledoluis776@gmail.com',
        pass: 'mpwd hzcm rrsm bwlr', // Contraseña de aplicación
    },
});

// Ruta para enviar correo con archivo protegido y enlace temporal
app.post('/send-email', upload.array('files', 10), async (req, res) => {
    const { to, subject, text, password } = req.body;
    const files = req.files;

    const zipFilePath = path.join(uploadsDir, `protected-${Date.now()}.zip`);

    try {
        // Generar archivo ZIP protegido con contraseña
        const zip = add(zipFilePath, files.map(file => file.path), {
            password,
            $bin: require('7zip-bin').path7za,
        });

        zip.on('end', async () => {
            console.log('Archivo ZIP protegido creado.');

            // Crear token JWT con fecha de expiración
            const token = jwt.sign(
                { filename: path.basename(zipFilePath) },
                SECRET_KEY,
                { expiresIn: EXPIRATION_TIME / 1000 } // Convertir a segundos
            );

            const downloadLink = `http://localhost:${PORT}/download/${token}`;
            console.log('Enlace de descarga generado:', downloadLink);

            const qrCode = await QRCode.toDataURL(downloadLink);

            const mailOptions = {
                from: 'robledoluis776@gmail.com',
                to,
                subject,
                html: `
                    <p>${text}</p>
                    <p>El archivo está protegido con la siguiente contraseña: <strong>${password}</strong></p>
                    <p>Puedes descargarlo usando este <a href="${downloadLink}">enlace</a></p>
                    <p><strong>Nota:</strong> El enlace expirará en 2 dias.</p>
                `,
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error al enviar el correo:', error);
                    return res.status(500).send('Error al enviar el correo.');
                }
                console.log('Correo enviado:', info.response);
                res.status(200).send('Correo enviado exitosamente.');
            });
        });

        zip.on('error', (err) => {
            console.error('Error al generar el ZIP:', err);
            res.status(500).send('Error al generar el archivo ZIP.');
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error al procesar el archivo.');
    }
});

// Ruta para descargar el archivo usando un token JWT
app.get('/download/:token', (req, res) => {
    const { token } = req.params;

    try {
        const { filename } = jwt.verify(token, SECRET_KEY); // Verificar token
        const filepath = path.join(uploadsDir, filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).send('Archivo no encontrado.');
        }

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.download(filepath, (err) => {
            if (err) {
                console.error('Error al descargar el archivo:', err);
                res.status(500).send('Error al descargar el archivo.');
            } else {
                // Eliminar el archivo después de 2 dias
                setTimeout(() => {
                    fs.unlink(filepath, (err) => {
                        if (err) console.error('Error al eliminar archivo:', err);
                        else console.log('Archivo eliminado tras caducar.');
                    });
                }, EXPIRATION_TIME);
            }
        });
    } catch (err) {
        console.error('Token inválido o expirado:', err);
        res.status(410).send('El enlace ha expirado o no es válido.');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
