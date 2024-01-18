const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./Models/User');
const Place = require('./Models/Place');
const Booking = require('./Models/Booking')

const cookieParser = require('cookie-parser');
const imageDownloader = require('image-downloader');
const multer = require('multer');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 5000;

const bcryptSalt = bcrypt.genSaltSync(10);
const jwtSecret = 'hideandseekandseekandhide';

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));
app.use(cors({
    credentials: true,
    origin: 'http://localhost:3000',
}));



function getUserDataFromToken(req){
    return new Promise((resolve,reject) =>{
        jwt.verify(req.cookies.token,jwtSecret,{},async(err,userData)=> {
            if(err) throw err;
            resolve(userData)
        });
    });
}

// Registration route
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const userDoc = await User.create({
            name,
            email,
            password: bcrypt.hashSync(password, bcryptSalt),
        });
        res.json(userDoc);
    } catch (e) {
        res.status(422).json(e);
    }
});

// Login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const userDoc = await User.findOne({ email });

    if (userDoc) {
        const passOk = bcrypt.compareSync(password, userDoc.password);
        if (passOk) {
            jwt.sign({
                email: userDoc.email,
                id: userDoc._id,
                name: userDoc.name,
            }, jwtSecret, {}, (err, token) => {
                if (err) throw err;
                res.cookie('token', token).json(userDoc);
            });
        } else {
            res.status(422).json('Password not correct');
        }
    } else {
        res.status(404).json('User not found');
    }
});

// Profile route
app.get('/profile', (req, res) => {
    const { token } = req.cookies;
    if (token) {
        jwt.verify(token, jwtSecret, {}, async (err, userData) => {
            if (err) throw err;
            try {
                const { name, email, _id } = await User.findById(userData.id);
                res.json({ name, email, _id });
            } catch (error) {
                res.status(404).json(null);
            }
        });
    } else {
        res.json(null);
    }
});

// Refresh Token route
app.get('/refreshtoken', (req, res) => {
    const cookie = req.headers.cookie;
    const oldToken = cookie.split('=')[1];

    if (!oldToken) {
        return res.status(400).json({ message: 'Something went wrong' });
    }

    jwt.verify(
        String(oldToken),
        jwtSecret,
        (error, user) => {
            if (error) {
                return res.status(403).json({ message: 'Authentication failed' });
            }

            res.clearCookie(`${user.id}`);
            req.cookies[`${user.id}`] = '';
            const newToken = jwt.sign(
                { id: user.id },
                jwtSecret,
                {
                    expiresIn: '35s',
                }
            );

            res.cookie(String(user.id), newToken, {
                path: '/',
                expires: new Date(Date.now() + 1000 * 30),
                httpOnly: true,
                sameSite: 'lax',
            });
            req.id = user.id;
            res.json({ message: 'Token refreshed', newToken });
        }
    );
});

// Logout route
app.post('/logout', (req, res) => {
    const cookie = req.headers.cookie;
    const oldToken = cookie.split('=')[1];

    if (!oldToken) {
        return res.status(400).json({ message: 'Something went wrong' });
    }

    jwt.verify(
        String(oldToken),
        jwtSecret,
        (error, user) => {
            if (error) {
                return res.status(403).json({ message: 'Authentication failed' });
            }

            res.clearCookie(`${user.id}`);
            req.cookies[`${user.id}`] = '';
            res.json({ message: 'Logged out' });
        }
    );
});

// Photo upload by link route
app.post('/uploadbylink', async (req, res) => {
    try {
        const { link } = req.body;
        const newName = 'photo' + Date.now() + '.jpeg';
        console.log(`Received link: ${link}`);
        console.log(`Saving image as: ${newName}`);

        const destinationPath = path.join(__dirname, 'uploads', newName);

        await imageDownloader.image({
            url: link,
            dest: destinationPath,
            timeout: 10000,
        });

        console.log('Image download and save successful');
        res.json({ success: true, imageName: newName });
    } catch (error) {
        if (error.name === 'TimeoutError') {
            console.error('Timeout error during image upload:', error);
            res.status(500).json({ success: false, error: 'Timeout Error' });
        } else {
            console.error('Error during image upload:', error);

            // Log additional details if available
            if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }

            res.status(500).json({ success: false, error: 'Internal Server Error' });
        }
    }
});

// Photo upload route using multer middleware
const photosMiddleware = multer({ dest: 'uploads/' });
app.post('/upload', photosMiddleware.array('photos', 100), (req, res) => {
    const uploadedFiles = [];
    for (let i = 0; i < req.files.length; i++) {
        const { path, originalname } = req.files[i];
        const parts = originalname.split('.');
        const ext = parts[parts.length - 1];
        const newPath = path + '.' + ext;
        fs.renameSync(path, newPath);
        uploadedFiles.push(newPath.replace('uploads/', ''));
    }
    res.json(uploadedFiles);
});

// Post places
app.post('/places', (req, res) => {
    const { token } = req.cookies;
    const {
        title, address, addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests,price
    } = req.body;
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
        if (err) throw err;
        const placeDoc = await Place.create({
            owner: userData.id,price,
            title, address, photos: addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests,
        });
        res.json(placeDoc);
    });
});

// Get places
app.get('/user-places', (req, res) => {
    const { token } = req.cookies;
    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
        const { id } = userData;
        res.json(await Place.find({ owner: id }));
    });
});

app.get('/places/:id', async (req, res) => {
    const { id } = req.params;
    res.json(await Place.findById(id));
});

app.put('/places', async (req, res) => {
    const { token } = req.cookies;
    const {
        id, title, address, addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests,price,
    } = req.body;

    jwt.verify(token, jwtSecret, {}, async (err, userData) => {
        if (err) throw err;
        const placeDoc = await Place.findById(id);

        if (userData.id === placeDoc.owner.toString()) {
            placeDoc.set({
                title, address, photos: addedPhotos, description, perks, extraInfo, checkIn, checkOut, maxGuests,price,
            });
            await placeDoc.save();
            res.json('ok');
        }
    });
});

app.get('/places',async(req,res)=>{
    res.json(await Place.find())
})


app.post('/bookings',async (req,res)=>{
    const userData = await getUserDataFromToken(req);
    const {
        place,checkIn,checkOut,name,phone,price,numberOfGuests,
    } =req.body;
    Booking.create({
        place,checkIn,checkOut,numberOfGuests,name,phone,price,
        user:userData.id,
    }).then((doc)=> {
        res.json(doc);
    }).catch((err) =>{
        throw err;
    });
});





app.get('/bookings', async (req,res) => {
    const userData = await getUserDataFromToken(req);
    res.json(await Booking.find({user : userData.id}).populate('place'));
});

// Start the server
const start = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        app.listen(port, () => console.log(`Server listening at port no ${port}`));
    } catch (error) {
        console.log(error);
    }
};

start();
