# Nowcast (Experimental): DeepMind DGMR

The Nowcast's model is the Deep Generative Model of Rainfall (DGMR) by DeepMind, the 256 x 256 snapshot published with
https://github.com/google-deepmind/deepmind-research/tree/master/nowcasting. Copyright 2021 DeepMind Technologies Limited. The model
snapshot is licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0):
https://creativecommons.org/licenses/by/4.0/ (the full text travels in the model pack as LICENSE, and is licenses/LICENSE-CC-BY-4.0.txt
in the app).

Modified by the p0pc0rn project: the weights converted to 16-bit floating point (the full model) or quantised to 8-bit integers with
spectral and batch normalisation folded (the low-memory model), and run as p0pc0rn's own WebGPU kernels. Not the original files. Trained
by DeepMind on UK radar; p0pc0rn runs it on US radar as an experiment. Not an official DeepMind or Google product.

Credit line: "Nowcast model: DeepMind DGMR (CC BY 4.0), modified".
