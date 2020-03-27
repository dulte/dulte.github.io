.. Einstein Toolkit Converter documentation master file, created by
   sphinx-quickstart on Wed Mar 25 12:23:02 2020.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

Welcome to Einstein Toolkit Converter's documentation!
======================================================

Introduction
============
This is a converter tool that converts Binary Black Hole Mergers simulated in Einstein Toolkit
to a Spectral Representation used in Gyoto to do numerical raytracing.

This is part of my Master Thesis in Astrophysics at The University of Oslo.

The code is as of now not available, but can be distributed on request. The reason
is that it is still written, and that it is very ugly and ad hoc...


Installation
============

This documentation is mostly meant for me and my suppervisor. It can be given out
at request, but keep this in mind.

Prerequsits
-----------

- Numpy 
- Matplotlib
- PostCactus_

- Python 2.7 (Sadly PostCactus is only supported in 2.7 :( )
- GCC
- LORENE_
- get_points.C, A C code written by my (can also be given out at request)

.. _PostCactus: https://bitbucket.org/DrWhat/pycactuset/wiki/Installation
.. _LORENE: https://lorene.obspm.fr/index.html

Installation
------------
As of now you only need this file and the C file, and you are ready to go.


Basic Usage
===========
Given you have simulated the BH merger in Einstein Toolkit, you can use this. 
Most user will only need to use make_geometry/make_positive_geometry and analyse_bbh. 
A typical run example will be

.. code-block:: python

   folder = "/some_location/simulations/bbh_3D"
   inter = ETInterpolater(folder, 2)

   g = inter.make_positive_geometry([100, 100, 100], 200)
   it = [0, 128, 256] #And more

   inter.analyse_bbh(g, quantity="", it, test=True)





.. toctree::
   :maxdepth: 2
   :caption: Contents:

   modules

Indices and tables
==================

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
